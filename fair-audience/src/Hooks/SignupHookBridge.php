<?php
/**
 * Signup Hook Bridge
 *
 * Extends fair-events' unified event-signup block/route (fair-events/v1/get-tickets)
 * for the simple anonymous/linked case, instead of owning a competing create route.
 * See fair-events/REST_API_BACKEND.md for the documented hook contract.
 *
 * @package FairAudience
 */

namespace FairAudience\Hooks;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\EventParticipantTransactionRepository;
use FairAudience\Models\Participant;
use FairAudience\Services\AudienceSession;
use FairAudience\Services\EmailService;
use FairAudience\Services\GroupSignupPricing;
use FairAudience\Services\SignupActivities;
use FairAudience\Services\SignupPriceResolver;

defined( 'WPINC' ) || die;

/**
 * Bridges the base fair-events signup render/create path to fair-audience's
 * participant records for the simple (anonymous/linked, non-group-restricted)
 * signup case. The identity routes (/status, /resume,
 * /request-link, /register, /retry-payment, /add-activities) stay on
 * fair-audience/v1 and are unaffected by this bridge.
 */
class SignupHookBridge {

	/**
	 * Initialize hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_filter( 'fair_events_signup_render_context', array( static::class, 'enrich_render_context' ), 10, 1 );
		add_action( 'fair_events_signup_render_before_submit', array( static::class, 'render_discount_note' ), 10, 1 );
		add_filter( 'fair_events_signup_ticket_type_error', array( static::class, 'filter_ticket_type_error' ), 10, 2 );
		add_filter( 'fair_events_signup_unit_price', array( static::class, 'filter_unit_price' ), 10, 2 );
		add_filter( 'fair_events_signup_options_error', array( static::class, 'filter_options_error' ), 10, 4 );
		add_filter( 'fair_events_signup_option_line_items', array( static::class, 'filter_option_line_items' ), 10, 3 );
		add_action( 'fair_events_signup_render_after_form', array( static::class, 'render_add_activities' ), 10, 1 );
		add_action( 'fair_events_signup_created', array( static::class, 'link_participant' ), 10, 6 );
		add_action( 'fair_events_signup_confirmed', array( static::class, 'handle_signup_confirmed' ), 10, 2 );
		add_action( 'fair_events_signup_payment_failed', array( static::class, 'handle_signup_payment_failed' ), 10, 2 );
		add_action( 'fair_events_backfill_signup_participant_ids', array( static::class, 'backfill_signup_participant_ids' ) );
	}

	/**
	 * Inject the signed-in/known viewer's name and email into the base
	 * form's pre-fill so returning participants don't retype them, filter out
	 * group-restricted ticket types the viewer can't buy, and re-resolve
	 * prices through the viewer's group discounts.
	 *
	 * @param array $context Render context from fair-events' base render.
	 * @return array Filtered context.
	 */
	public static function enrich_render_context( $context ) {
		$participant    = GroupSignupPricing::resolve_viewer_participant();
		$participant_id = $participant ? (int) $participant->id : null;

		if ( $participant ) {
			$context['prefill_name']  = trim( $participant->name . ' ' . $participant->surname );
			$context['prefill_email'] = (string) $participant->email;
		}

		$context['group_discount_rule'] = null;

		if ( ! empty( $context['ticket_types'] ) ) {
			$pricing_event_date_id = (int) $context['pricing_event_date_id'];

			if ( class_exists( \FairEventsExperimental\Models\TicketTypeGroupRestriction::class ) ) {
				$restrictions_map = \FairEventsExperimental\Models\TicketTypeGroupRestriction::get_all_by_event_date_id( $pricing_event_date_id );

				if ( ! empty( $restrictions_map ) ) {
					$member_group_ids = array();
					if ( $participant_id && class_exists( \FairAudienceExperimental\Database\GroupParticipantRepository::class ) ) {
						$group_participant_repo = new \FairAudienceExperimental\Database\GroupParticipantRepository();
						$memberships            = $group_participant_repo->get_by_participant( $participant_id );
						$member_group_ids       = array_map(
							function ( $membership ) {
								return (int) $membership->group_id;
							},
							$memberships
						);
					}

					$context['ticket_types'] = GroupSignupPricing::allowed_ticket_types(
						$context['ticket_types'],
						$restrictions_map,
						$member_group_ids
					);
				}
			}

			// Re-resolve prices for the surviving types through the same authority
			// the create route uses, so the displayed price matches what gets
			// charged. Clamped at 0 — an amount-discount larger than the price
			// can never show (or charge) a negative amount.
			$price_by_type_id = array();
			foreach ( $context['ticket_types'] as $ticket_type ) {
				$resolved = SignupPriceResolver::resolve_price_for_ticket_type( (int) $ticket_type->id, $participant_id );
				if ( null !== $resolved ) {
					$price_by_type_id[ (int) $ticket_type->id ] = max( 0, $resolved );
				}
			}
			$context['price_by_type_id'] = $price_by_type_id;

			if ( $participant_id && class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
				$context['group_discount_rule'] = \FairEventsExperimental\Services\EventSignupPricing::resolve_best_discount_rule(
					$pricing_event_date_id,
					$participant_id
				);
			}
		}

		// Activities (ticket options) are independent of ticket types — an
		// event can sell activities alongside a free, type-less signup — so
		// this runs unconditionally.
		$context = SignupActivities::enrich_render_context( $context, $participant_id );

		return $context;
	}

	/**
	 * Render the group discount note just before the submit button, when the
	 * viewer's best-matching group discount rule was stashed onto the context
	 * by enrich_render_context().
	 *
	 * @param array $context Render context, see fair_events_signup_render_context.
	 * @return void
	 */
	public static function render_discount_note( $context ) {
		$rule = $context['group_discount_rule'] ?? null;
		if ( ! $rule ) {
			return;
		}

		$group_name = '';
		if ( class_exists( \FairAudienceExperimental\Database\GroupRepository::class ) ) {
			$group_repo = new \FairAudienceExperimental\Database\GroupRepository();
			$group      = $group_repo->get_by_id( (int) $rule->group_id );
			if ( $group ) {
				$group_name = $group->name;
			}
		}

		echo '<p class="fair-events-get-tickets-discount-note">'
			. esc_html( GroupSignupPricing::discount_note_label( $rule, $group_name ) )
			. '</p>';
	}

	/**
	 * Reject a signup for a group-restricted ticket type the viewer isn't a
	 * member of. Hooked on fair_events_signup_ticket_type_error.
	 *
	 * @param WP_Error|null $error          Prior filter result — passed through unchanged if already an error.
	 * @param int           $ticket_type_id Ticket type ID.
	 * @return \WP_Error|null
	 */
	public static function filter_ticket_type_error( $error, $ticket_type_id ) {
		if ( is_wp_error( $error ) ) {
			return $error;
		}

		$participant = GroupSignupPricing::resolve_viewer_participant();
		return GroupSignupPricing::restriction_error( $ticket_type_id, $participant ? (int) $participant->id : null );
	}

	/**
	 * Re-resolve a ticket type's unit price through the viewer's group
	 * discounts. Hooked on fair_events_signup_unit_price.
	 *
	 * @param float|null $unit_price     Base unit price, or null when not purchasable.
	 * @param int        $ticket_type_id Ticket type ID.
	 * @return float|null
	 */
	public static function filter_unit_price( $unit_price, $ticket_type_id ) {
		if ( null === $unit_price ) {
			return $unit_price;
		}

		$participant    = GroupSignupPricing::resolve_viewer_participant();
		$participant_id = $participant ? (int) $participant->id : null;

		$resolved = SignupPriceResolver::resolve_price_for_ticket_type( $ticket_type_id, $participant_id );
		if ( null === $resolved ) {
			return $unit_price;
		}

		return max( 0, $resolved );
	}

	/**
	 * Validate a submitted activity (ticket option) selection: belongs to the
	 * event date, not full, and meets the effective minimum-activities
	 * requirement. Hooked on fair_events_signup_options_error.
	 *
	 * @param WP_Error|null $error                 Prior filter result — passed through unchanged if already an error.
	 * @param int[]         $ticket_option_ids      Submitted option IDs.
	 * @param int           $pricing_event_date_id Event date the activity catalogue belongs to.
	 * @param int           $ticket_type_id         Selected ticket type ID, or 0 for none.
	 * @return \WP_Error|null
	 */
	public static function filter_options_error( $error, $ticket_option_ids, $pricing_event_date_id, $ticket_type_id ) {
		if ( is_wp_error( $error ) ) {
			return $error;
		}

		return SignupActivities::validate_selection( (array) $ticket_option_ids, (int) $pricing_event_date_id, (int) $ticket_type_id );
	}

	/**
	 * Resolve priced line items for a submitted activity selection, applying
	 * the viewer's best group discount rule. Hooked on
	 * fair_events_signup_option_line_items.
	 *
	 * @param array $line_items            Prior filter result (empty by default).
	 * @param int[] $ticket_option_ids     Submitted option IDs.
	 * @param int   $pricing_event_date_id Event date the activity catalogue belongs to.
	 * @return array[]
	 */
	public static function filter_option_line_items( $line_items, $ticket_option_ids, $pricing_event_date_id ) {
		if ( empty( $ticket_option_ids ) ) {
			return $line_items;
		}

		$participant    = GroupSignupPricing::resolve_viewer_participant();
		$participant_id = $participant ? (int) $participant->id : null;

		return array_merge(
			$line_items,
			SignupActivities::line_items( (array) $ticket_option_ids, (int) $pricing_event_date_id, $participant_id )
		);
	}

	/**
	 * Render the "add activities" section for a signed-up viewer, listing
	 * only the activities they don't already have (stashed onto the context
	 * as 'addable_options' by enrich_render_context()). No-op when there's
	 * nothing to add. Reuses the legacy form's markup/behaviour, submitting
	 * through fair-audience's existing add-activities route — the path a
	 * companion plugin owns is read from a data attribute so the base plugin
	 * never hardcodes it.
	 *
	 * @param array $context Render context, see fair_events_signup_render_context.
	 * @return void
	 */
	public static function render_add_activities( $context ) {
		$addable_options = $context['addable_options'] ?? array();
		if ( empty( $addable_options ) ) {
			return;
		}

		$event_date_id = (int) ( $context['event_date_id'] ?? 0 );
		$event_id      = 0;
		if ( $event_date_id && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
			if ( $event_date ) {
				$event_id = (int) $event_date->get_resolved_event_id();
			}
		}
		if ( ! $event_id ) {
			return;
		}

		$participant = GroupSignupPricing::resolve_viewer_participant();
		$token       = $participant ? \FairAudience\Services\ParticipantToken::generate( (int) $participant->id, $event_date_id ) : '';

		echo '<div class="fair-events-add-activities"'
			. ' data-event-id="' . esc_attr( (string) $event_id ) . '"'
			. ' data-event-date-id="' . esc_attr( (string) $event_date_id ) . '"'
			. ' data-participant-token="' . esc_attr( $token ) . '">';
		echo '<fieldset>';
		echo '<legend>' . esc_html__( 'Add activities', 'fair-audience' ) . '</legend>';

		if ( ! empty( $context['current_activity_names'] ) ) {
			echo '<p>' . esc_html__( 'Your activities:', 'fair-audience' ) . '</p><ul>';
			foreach ( $context['current_activity_names'] as $activity_name ) {
				echo '<li>' . esc_html( $activity_name ) . '</li>';
			}
			echo '</ul>';
		}

		foreach ( $addable_options as $option ) {
			$is_full      = ! empty( $option['is_full'] );
			$option_label = $option['name'];
			if ( $option['price'] > 0 ) {
				$option_label .= ' — ' . \FairEventsShared\Money::format_inline( $option['price'] );
			} elseif ( $option['price'] < 0 ) {
				$option_label .= ' — -' . \FairEventsShared\Money::format_inline( abs( $option['price'] ) );
			} else {
				$option_label .= ' — ' . __( 'free', 'fair-audience' );
			}
			if ( $is_full ) {
				$option_label .= ' — ' . __( 'full', 'fair-audience' );
			}
			$checkbox_id = 'fair-events-add-opt-' . (int) $option['id'];
			$classes     = 'fair-events-ticket-option-item';
			if ( $is_full ) {
				$classes .= ' fair-events-ticket-option-full';
			}
			echo '<label class="' . esc_attr( $classes ) . '" for="' . esc_attr( $checkbox_id ) . '">';
			echo '<input type="checkbox" name="add_option_ids[]" id="' . esc_attr( $checkbox_id ) . '" value="' . (int) $option['id'] . '"'
				. ' data-option-price="' . esc_attr( \FairEventsShared\Money::format_value( $option['price'] ) ) . '"'
				. ( $is_full ? ' disabled' : '' ) . ' /> ';
			echo esc_html( $option_label );
			echo '</label>';
		}

		echo '<div class="wp-block-button">';
		echo '<button type="button" class="wp-block-button__link wp-element-button fair-events-add-activities-button" disabled>';
		echo esc_html__( 'Add activities', 'fair-audience' );
		echo '</button>';
		echo '</div>';
		echo '</fieldset>';
		echo '</div>';
	}

	/**
	 * Create or link the Participant + EventParticipant records for a signup
	 * created through the base fair-events/v1/get-tickets route, set the
	 * session cookie, and send the confirmation email — mirroring the simple
	 * path of EventSignupController::create_signup() without duplicating its
	 * group/sliding-scale/questionnaire handling.
	 *
	 * @param int      $signup_id        The fair_events_signups row just created.
	 * @param int      $event_date_id    Event-date ID the signup targets.
	 * @param string   $name             Buyer name.
	 * @param string   $email            Buyer email.
	 * @param array    $ticket_selection Ticket selection ('ticket_type_id', 'quantity', 'event_date_ids').
	 * @param int|null $transaction_id   fair-payments-connector transaction ID, or null on the free path.
	 * @return void
	 */
	public static function link_participant( $signup_id, $event_date_id, $name, $email, $ticket_selection, $transaction_id ) {
		if ( empty( $email ) || ! is_email( $email ) ) {
			return;
		}

		if ( ! class_exists( \FairEvents\Models\EventDates::class ) ) {
			return;
		}

		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return;
		}

		$event_id = $event_date->get_resolved_event_id();
		if ( ! $event_id ) {
			return;
		}

		$participant_repository = new ParticipantRepository();
		$participant            = $participant_repository->get_by_email( $email );

		if ( ! $participant ) {
			$participant = new Participant();
			$participant->populate(
				array(
					'name'          => $name,
					'email'         => $email,
					'email_profile' => 'minimal',
					'status'        => 'confirmed',
				)
			);
			if ( ! $participant->save() ) {
				return;
			}
		}

		if ( class_exists( \FairEvents\Models\EventSignup::class ) ) {
			\FairEvents\Models\EventSignup::update_participant( (int) $signup_id, (int) $participant->id );
		}

		$event_participant_repository = new EventParticipantRepository();
		$label                        = $transaction_id ? 'pending_payment' : 'signed_up';
		$ticket_type_id               = ! empty( $ticket_selection['ticket_type_id'] ) ? (int) $ticket_selection['ticket_type_id'] : null;

		$existing      = $event_participant_repository->get_by_event_date_and_participant( $event_date_id, $participant->id );
		$stamp_payment = false;

		if ( $existing ) {
			if ( 'signed_up' !== $existing->label ) {
				$event_participant_repository->update_label_by_event_date( $event_date_id, $participant->id, $label );
				$stamp_payment = (bool) $transaction_id;
			}
		} else {
			$event_participant_repository->add_participant_to_event( $event_id, $participant->id, $label, $event_date_id );
			$stamp_payment = (bool) $transaction_id;
		}

		// Only stamp payment metadata when this call created the junction row
		// or upgraded it from a non-signed_up label, so a later signed_up
		// relationship never gets clobbered by an unrelated purchase.
		if ( $stamp_payment ) {
			$relationship = $event_participant_repository->get_by_event_date_and_participant( $event_date_id, $participant->id );
			if ( $relationship ) {
				$relationship->ticket_type_id     = $ticket_type_id;
				$relationship->payment_expires_at = gmdate( 'Y-m-d H:i:s', time() + 15 * MINUTE_IN_SECONDS );
				$relationship->save();

				// Record the ledger link at creation time, not just on webhook
				// confirmation — mirrors EventSignupController's own creation
				// sites (see #1112).
				if ( $transaction_id ) {
					( new EventParticipantTransactionRepository() )->record( (int) $relationship->id, (int) $transaction_id, 'charge' );
				}
			}
		}

		// Attach selected activities on both the free and pending_payment
		// paths, matching the legacy form. Uses $existing (already fetched
		// above) when the relationship pre-existed, otherwise re-fetches the
		// row add_participant_to_event() just created.
		if ( ! empty( $ticket_selection['ticket_option_ids'] ) && class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
			$relationship_for_options = $existing
				? $existing
				: $event_participant_repository->get_by_event_date_and_participant( $event_date_id, $participant->id );
			if ( $relationship_for_options ) {
				$options = array();
				foreach ( $ticket_selection['ticket_option_ids'] as $option_id ) {
					$option = \FairEventsExperimental\Models\TicketOption::get_by_id( (int) $option_id );
					if ( $option ) {
						$options[] = $option;
					}
				}
				$event_participant_repository->add_options( (int) $relationship_for_options->id, $options );
			}
		}

		AudienceSession::set( (int) $participant->id );

		if ( ! $transaction_id ) {
			$email_service = new EmailService();
			$event         = get_post( $event_id );
			$email_service->send_signup_payment_confirmation( $participant, $event, null, array(), (int) $event_date_id );
		}
	}

	/**
	 * Flip the matching EventParticipant row from pending_payment to
	 * signed_up when a base-route signup's payment is confirmed, and record
	 * the charge in the ledger — mirroring PaymentHooks::handle_signup_paid()
	 * for fair-audience's own signup routes.
	 *
	 * @param object $signup      The fair_events_signups row (status already 'confirmed').
	 * @param object $transaction Transaction object from fair-payments-connector.
	 * @return void
	 */
	public static function handle_signup_confirmed( $signup, $transaction ) {
		if ( empty( $signup->participant_id ) ) {
			return;
		}

		$event_participant_repository = new EventParticipantRepository();
		$event_participant            = $event_participant_repository->get_by_event_date_and_participant(
			(int) $signup->event_date_id,
			(int) $signup->participant_id
		);

		if ( ! $event_participant || 'pending_payment' !== $event_participant->label ) {
			return;
		}

		$event_participant->label              = 'signed_up';
		$event_participant->payment_expires_at = null;
		$event_participant->save();

		$ledger = new EventParticipantTransactionRepository();
		$ledger->record( (int) $event_participant->id, (int) $transaction->id, 'charge' );
	}

	/**
	 * No-op on a base-route signup's failed/cancelled/expired payment.
	 *
	 * Matches fair-audience's own signup routes: the bridged EventParticipant
	 * row stays pending_payment so the resume-link flow keeps working, and
	 * the expiry cron releases the held capacity once the window passes
	 * (EventParticipantRepository::delete_expired_pending_payments() guards
	 * that cleanup with EventSignup::has_confirmed_signup() so a later,
	 * already-confirmed signup on the same date never loses its row).
	 *
	 * @param object $signup      The fair_events_signups row (status already 'failed').
	 * @param object $transaction Transaction object from fair-payments-connector.
	 * @return void
	 */
	public static function handle_signup_payment_failed( $signup, $transaction ) {
		// Intentionally no-op — see method docblock above.
	}

	/**
	 * Backfill participant_id on existing fair_events_signups rows by
	 * matching their stored email to a fair-audience Participant.
	 *
	 * Triggered by fair-events' 3.24.0 migration. Idempotent: only touches
	 * rows where participant_id IS NULL, matching participants by email in a
	 * single UPDATE ... JOIN. Also run directly from fair-audience's own
	 * activation/upgrade path, since the fair-events migration may run while
	 * fair-audience is inactive.
	 *
	 * @return void
	 */
	public static function backfill_signup_participant_ids() {
		global $wpdb;

		$signups_table      = $wpdb->prefix . 'fair_events_signups';
		$participants_table = $wpdb->prefix . 'fair_audience_participants';

		// The signups table may not have gained its participant_id column yet
		// (e.g. this runs from fair-audience's own upgrade path before
		// fair-events applies its 3.24.0 migration). Skip quietly — the
		// fair-events migration fires this same action once the column exists.
		$column_exists = $wpdb->get_results(
			$wpdb->prepare(
				'SHOW COLUMNS FROM %i LIKE %s',
				$signups_table,
				'participant_id'
			)
		);
		if ( empty( $column_exists ) ) {
			return;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i AS s
				INNER JOIN %i AS p ON p.email = s.email
				SET s.participant_id = p.id
				WHERE s.participant_id IS NULL',
				$signups_table,
				$participants_table
			)
		);
	}
}
