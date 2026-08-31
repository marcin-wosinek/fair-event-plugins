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
use FairAudience\Database\EmailConfirmationTokenRepository;
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
		add_filter( 'fair_events_signup_viewer_context', array( static::class, 'enrich_render_context' ), 10, 1 );
		add_filter( 'fair_events_signup_precheck_error', array( static::class, 'filter_precheck_error' ), 10, 4 );
		add_action( 'fair_events_signup_render_before_form', array( static::class, 'render_signed_up_card' ), 10, 1 );
		add_action( 'fair_events_signup_render_before_form', array( static::class, 'render_not_you' ), 10, 1 );
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
	 * Inject the signed-in/known viewer's name and email into the form's
	 * pre-fill so returning participants don't retype them, filter out
	 * group-restricted ticket types the viewer can't buy, and re-resolve
	 * prices through the viewer's group discounts.
	 *
	 * Hooked on fair_events_signup_viewer_context — resolved at request time
	 * by GetTicketsController::get_viewer_context(), never by the base
	 * render.php a full-page cache stores and replays (#1300).
	 *
	 * @param array $context Context from fair-events' viewer-context endpoint.
	 * @return array Filtered context.
	 */
	public static function enrich_render_context( $context ) {
		$participant    = GroupSignupPricing::resolve_viewer_participant();
		$participant_id = $participant ? (int) $participant->id : null;

		// Signals the endpoint that a viewer was actually recognised, so it
		// renders the personalized fragments — true whenever prefill applies,
		// even when nothing else about ticket types/pricing changed.
		$context['viewer_resolved'] = (bool) $participant;

		if ( $participant ) {
			$context['prefill_name']  = trim( $participant->name . ' ' . $participant->surname );
			$context['prefill_email'] = (string) $participant->email;
		}

		$context['group_discount_rule'] = null;

		if ( ! empty( $context['ticket_types'] ) ) {
			$pricing_event_date_id = (int) $context['pricing_event_date_id'];

			if ( class_exists( \FairEvents\Models\TicketTypeGroupRestriction::class ) ) {
				$restrictions_map = \FairEvents\Models\TicketTypeGroupRestriction::get_all_by_event_date_id( $pricing_event_date_id );

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
			// can never show (or charge) a negative amount. Each type's own
			// winning rule rides along so the note below can tell whether every
			// discounted type agrees on the same rule (issue #1297). Resolved in
			// one bulk call so the sale period, discount rules, and viewer's
			// group membership are each fetched once per render, not once per
			// tier (issue #1299).
			$ticket_type_ids     = array_map(
				static function ( $ticket_type ) {
					return (int) $ticket_type->id;
				},
				$context['ticket_types']
			);
			$resolved_by_type_id = SignupPriceResolver::resolve_prices_and_rules_for_ticket_types(
				$pricing_event_date_id,
				$ticket_type_ids,
				$participant_id
			);

			$price_by_type_id = array();
			$rule_by_type_id  = array();
			foreach ( $resolved_by_type_id as $ticket_type_id => $resolved ) {
				$price_by_type_id[ $ticket_type_id ] = max( 0, $resolved['price'] );
				if ( null !== $resolved['rule'] ) {
					$rule_by_type_id[ $ticket_type_id ] = $resolved['rule'];
				}
			}
			$context['price_by_type_id'] = $price_by_type_id;

			// A single note can only name one rule, so it's shown solely when
			// every discounted type resolved to the same rule. A mixed-rule
			// event drops the note rather than risk misnaming a type's discount
			// — this block's note-only template has no per-type slot to attach
			// a per-type tag to (unlike fair-audience's own event-signup block).
			$reduced_rule_ids = array_values( array_unique( array_map( static fn( $rule ) => (int) $rule->id, $rule_by_type_id ) ) );
			if ( 1 === count( $reduced_rule_ids ) ) {
				$context['group_discount_rule'] = reset( $rule_by_type_id );
			}
		}

		// Activities (ticket options) are independent of ticket types — an
		// event can sell activities alongside a free, type-less signup — so
		// this runs unconditionally.
		$context = SignupActivities::enrich_render_context( $context, $participant_id );

		$context['suppress_form'] = false;
		$context['is_signed_up']  = false;

		if ( $participant_id && ! empty( $context['event_date_id'] ) && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_date_id                = (int) $context['event_date_id'];
			$event_participant_repository = new EventParticipantRepository();

			$existing     = $event_participant_repository->get_by_event_date_and_participant( $event_date_id, $participant_id );
			$is_signed_up = ( $existing && 'signed_up' === $existing->label );

			// Resolve a whole-series pass on the master once, so it can also
			// cover this occurrence (a pass covers occurrences starting on or
			// after its purchase date — mid-series semantics) and feed the
			// per-occurrence picker loop below without a query per row.
			$series_pass        = null;
			$event_date_row     = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
			$master_id_for_pass = null;
			if ( $event_date_row ) {
				if ( 'master' === ( $event_date_row->occurrence_type ?? null ) ) {
					$master_id_for_pass = (int) $event_date_row->id;
				} elseif ( 'generated' === ( $event_date_row->occurrence_type ?? null ) && $event_date_row->master_id ) {
					$master_id_for_pass = (int) $event_date_row->master_id;
				}
			}
			if ( $master_id_for_pass && class_exists( \FairEvents\Models\TicketType::class ) ) {
				$candidate_pass = $event_participant_repository->get_series_pass_for_participant( $master_id_for_pass, $participant_id );
				if ( $candidate_pass && $candidate_pass->ticket_type_id ) {
					$pass_tt = \FairEvents\Models\TicketType::get_by_id( (int) $candidate_pass->ticket_type_id );
					if ( $pass_tt && $pass_tt->is_whole_series() ) {
						$series_pass = $candidate_pass;
					}
				}
			}

			if ( ! $is_signed_up && $series_pass && $event_date_row && $event_date_row->start_datetime
				&& strtotime( $event_date_row->start_datetime ) >= strtotime( $series_pass->created_at )
			) {
				$is_signed_up = true;
			}

			$context['is_signed_up'] = $is_signed_up;

			if ( $is_signed_up ) {
				$context['suppress_form']          = true;
				$context['signed_up_ticket_label'] = '';

				$relationship_for_label = ( $existing && 'signed_up' === $existing->label ) ? $existing : $series_pass;
				if ( $relationship_for_label && $relationship_for_label->ticket_type_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
					$signed_up_ticket_type = \FairEvents\Models\TicketType::get_by_id( (int) $relationship_for_label->ticket_type_id );
					if ( $signed_up_ticket_type ) {
						$context['signed_up_ticket_label'] = $signed_up_ticket_type->name;
					}
				}
			}

			// Populate per-occurrence signup state for the pickers, mirroring
			// the legacy render — including the whole-series pass check above.
			if ( ! empty( $context['occurrences_for_picker'] ) ) {
				foreach ( $context['occurrences_for_picker'] as $idx => $occ_row ) {
					$rel           = $event_participant_repository->get_by_event_date_and_participant( (int) $occ_row['id'], $participant_id );
					$occ_signed_up = ( $rel && 'signed_up' === $rel->label );
					if ( ! $occ_signed_up && $series_pass && ! empty( $occ_row['start_datetime'] ) ) {
						$occ_signed_up = strtotime( $occ_row['start_datetime'] ) >= strtotime( $series_pass->created_at );
					}
					$context['occurrences_for_picker'][ $idx ]['signed_up'] = $occ_signed_up;
				}
			}
		}

		return $context;
	}

	/**
	 * Reject a signup for an event date the viewer already holds a
	 * `signed_up` relationship for. Hooked on fair_events_signup_precheck_error.
	 * A `pending_payment` relationship is not rejected here — that's an
	 * incomplete payment, not a genuine repeat, so a resubmit (e.g. via the
	 * payment retry card) must still be allowed through.
	 *
	 * @param WP_Error|null $error          Prior filter result — passed through unchanged if already an error.
	 * @param int           $event_date_id  Event-date ID the signup targets.
	 * @param string        $email          Submitted email (unused — the viewer is resolved by session/login).
	 * @param int           $ticket_type_id Submitted ticket type ID (unused).
	 * @return \WP_Error|null
	 */
	public static function filter_precheck_error( $error, $event_date_id, $email, $ticket_type_id ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- viewer is resolved by session/login, not the submitted email; required by the hook signature.
		if ( is_wp_error( $error ) ) {
			return $error;
		}

		// Scoped to a duplicate *ticket* purchase only — a free/no-ticket-type
		// signup (companion tickets, activity-only, a whole-series pass bought
		// again) is intentionally allowed to repeat; fair_events_signups rows
		// are many-per-participant-per-event by design (see the "Canonical
		// signup store" section of REST_API_BACKEND.md). This guard exists to
		// stop a resubmitted/double-clicked ticket purchase from writing a
		// second row and, on a paid tier, charging again — not to enforce
		// one-signup-per-participant in general.
		if ( ! $ticket_type_id ) {
			return $error;
		}

		$participant = GroupSignupPricing::resolve_viewer_participant();
		if ( ! $participant ) {
			return $error;
		}

		$event_participant_repository = new EventParticipantRepository();
		$existing                     = $event_participant_repository->get_by_event_date_and_participant( (int) $event_date_id, (int) $participant->id );

		if ( $existing && 'signed_up' === $existing->label && ! empty( $existing->ticket_type_id ) ) {
			return new \WP_Error(
				'already_signed_up',
				__( 'You already have a ticket for this date.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		return $error;
	}

	/**
	 * Render the signed-up/cancel card for a recognised viewer who already
	 * holds this signup — shown in place of the suppressed <form> (see
	 * enrich_render_context()'s suppress_form). Hooked on
	 * fair_events_signup_render_before_form.
	 *
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
	 * @return void
	 */
	public static function render_signed_up_card( $context ) {
		if ( empty( $context['is_signed_up'] ) ) {
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
		if ( ! $participant ) {
			return;
		}

		// The cancel route's permission check only accepts a logged-in user
		// or a valid participant_token — not the AudienceSession cookie most
		// unified-form viewers are recognised by — so a server-generated
		// token travels with the card exactly as render_add_activities() does.
		$token = \FairAudience\Services\ParticipantToken::generate( (int) $participant->id, $event_date_id );

		echo '<div class="fair-events-signed-up-card"'
			. ' data-event-id="' . esc_attr( (string) $event_id ) . '"'
			. ' data-event-date-id="' . esc_attr( (string) $event_date_id ) . '"'
			. ' data-participant-token="' . esc_attr( $token ) . '"'
			. ' data-cancel-route="/fair-audience/v1/event-signup">';

		echo '<p class="fair-events-signed-up-status">' . esc_html__( 'You are signed up for this date.', 'fair-audience' ) . '</p>';

		$ticket_label = $context['signed_up_ticket_label'] ?? '';
		if ( '' !== $ticket_label ) {
			echo '<p class="fair-events-signed-up-ticket">';
			printf(
				/* translators: %s: ticket type name */
				esc_html__( 'Your ticket: %s', 'fair-audience' ),
				'<strong>' . esc_html( $ticket_label ) . '</strong>' // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- pre-escaped substitution.
			);
			echo '</p>';
		}

		if ( ! empty( $context['current_activity_names'] ) ) {
			echo '<div class="fair-events-signed-up-activities"><p>' . esc_html__( 'Your activities:', 'fair-audience' ) . '</p><ul>';
			foreach ( $context['current_activity_names'] as $activity_name ) {
				echo '<li>' . esc_html( $activity_name ) . '</li>';
			}
			echo '</ul></div>';
		}

		// A date switcher that navigates via the existing ?event_date= param
		// (fair-events' render.php already resolves it) rather than
		// re-pivoting client-side, mirroring the legacy picker's own
		// behaviour — no client-side re-evaluation of a server-side decision.
		$occurrences = $context['occurrences_for_picker'] ?? array();
		if ( count( $occurrences ) > 1 ) {
			echo '<ul class="fair-events-signed-up-switch-date">';
			foreach ( $occurrences as $occ_row ) {
				if ( (int) $occ_row['id'] === $event_date_id ) {
					continue;
				}
				$occ_label = class_exists( \FairEvents\Helpers\DateRangeFormatter::class )
					? \FairEvents\Helpers\DateRangeFormatter::format( $occ_row['start_datetime'], $occ_row['end_datetime'], $occ_row['all_day'] )
					: $occ_row['start_datetime'];
				if ( ! empty( $occ_row['signed_up'] ) ) {
					$occ_label .= ' — ' . __( 'already signed up', 'fair-audience' );
				}
				$date_param = gmdate( 'Y-m-d', strtotime( $occ_row['start_datetime'] ) );
				$link       = add_query_arg( 'event_date', $date_param );
				echo '<li><a href="' . esc_url( $link ) . '">' . esc_html( $occ_label ) . '</a></li>';
			}
			echo '</ul>';
		}

		echo '<div class="wp-block-button">';
		echo '<button type="button" class="wp-block-button__link wp-element-button fair-events-cancel-signup-button is-style-outline">';
		echo esc_html__( 'Cancel signup', 'fair-audience' );
		echo '</button>';
		echo '</div>';

		echo '</div>';
	}

	/**
	 * Render the "Not you? Start fresh" button for a viewer recognised only
	 * via the session cookie (not signed up, form not suppressed) — lets them
	 * clear the pre-filled name/email and register as someone else. Hooked on
	 * fair_events_signup_render_before_form; wired client-side against the
	 * existing DELETE /fair-audience/v1/session route by fair-events-shared's
	 * wireNotYouButton(), the same helper the legacy block uses.
	 *
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
	 * @return void
	 */
	public static function render_not_you( $context ) {
		if ( ! empty( $context['suppress_form'] ) || empty( $context['prefill_email'] ) ) {
			return;
		}
		if ( ! AudienceSession::get_participant_id() ) {
			return;
		}

		echo '<button type="button" class="fair-events-not-you-button">'
			. esc_html__( 'Not you? Start fresh', 'fair-audience' )
			. '</button>';
	}

	/**
	 * Render the group discount note just before the submit button, when the
	 * viewer's best-matching group discount rule was stashed onto the context
	 * by enrich_render_context().
	 *
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
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
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
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
	 * @param array    $ticket_selection Ticket selection ('ticket_type_id', 'quantity',
	 *                                   'ticket_option_ids'/'event_date_ids', 'mailing_opt_in').
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
		$mailing_opt_in         = ! empty( $ticket_selection['mailing_opt_in'] );
		$is_new_participant     = false;

		if ( ! $participant ) {
			$participant = new Participant();
			$participant->populate(
				array(
					'name'          => $name,
					'email'         => $email,
					// Mirrors EventSignupController::register()'s new-participant
					// branch: only a brand-new participant's consent is recorded
					// here — an existing participant's profile/status is never
					// overwritten by a later signup's checkbox state.
					'email_profile' => $mailing_opt_in ? 'marketing' : 'minimal',
					'status'        => $mailing_opt_in ? 'pending' : 'confirmed',
				)
			);
			if ( ! $participant->save() ) {
				return;
			}
			$is_new_participant = true;
		}

		// Mailing-list double opt-in: dispatch the confirmation email as soon
		// as the participant lands in 'pending' status, mirroring
		// EventSignupController::register() (see #1112 for why this can't
		// wait until the free-signup tail below — a paid signup never
		// reaches it).
		if ( $is_new_participant && $mailing_opt_in ) {
			$token_repository = new EmailConfirmationTokenRepository();
			$token            = $token_repository->create_token( $participant->id );
			if ( $token ) {
				( new EmailService() )->send_confirmation_email( $participant, $token->token );
			}
		}

		if ( class_exists( \FairEvents\Models\EventSignup::class ) ) {
			\FairEvents\Models\EventSignup::update_participant( (int) $signup_id, (int) $participant->id );
		}

		$event_participant_repository = new EventParticipantRepository();
		$label                        = $transaction_id ? 'pending_payment' : 'signed_up';
		$ticket_type_id               = ! empty( $ticket_selection['ticket_type_id'] ) ? (int) $ticket_selection['ticket_type_id'] : null;

		$existing             = $event_participant_repository->get_by_event_date_and_participant( $event_date_id, $participant->id );
		$stamp_payment        = false;
		$event_participant_id = $existing ? (int) $existing->id : 0;

		if ( $existing ) {
			if ( 'signed_up' !== $existing->label ) {
				$event_participant_repository->update_label_by_event_date( $event_date_id, $participant->id, $label );
				$stamp_payment = (bool) $transaction_id;
			}
		} else {
			$event_participant_id = (int) $event_participant_repository->add_participant_to_event( $event_id, $participant->id, $label, $event_date_id );
			$stamp_payment        = (bool) $transaction_id;
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
			$email_service->send_signup_payment_confirmation( $participant, $event, null, array(), (int) $event_date_id, (int) $ticket_type_id, $event_participant_id );
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

		$already_signed_up = $event_participant && 'signed_up' === $event_participant->label;

		$metadata   = isset( $transaction->metadata ) && is_string( $transaction->metadata )
			? json_decode( $transaction->metadata, true )
			: (array) ( $transaction->metadata ?? array() );
		$option_ids = isset( $metadata['ticket_option_ids'] ) && is_array( $metadata['ticket_option_ids'] )
			? array_map( 'intval', $metadata['ticket_option_ids'] )
			: array();

		if ( ! $already_signed_up
			&& self::late_confirmation_exceeds_capacity( $signup, $option_ids, $event_participant_repository )
			&& class_exists( \FairEvents\Models\EventSignup::class )
			&& method_exists( \FairEvents\Models\EventSignup::class, 'mark_over_capacity' )
		) {
			\FairEvents\Models\EventSignup::mark_over_capacity( (int) $signup->id );
		}

		if ( ! $event_participant ) {
			$event_date = class_exists( \FairEvents\Models\EventDates::class )
				? \FairEvents\Models\EventDates::get_by_id( (int) $signup->event_date_id )
				: null;
			if ( ! $event_date ) {
				return;
			}
			$event_participant_repository->add_participant_to_event(
				(int) $event_date->get_resolved_event_id(),
				(int) $signup->participant_id,
				'signed_up',
				(int) $signup->event_date_id
			);
			$event_participant = $event_participant_repository->get_by_event_date_and_participant(
				(int) $signup->event_date_id,
				(int) $signup->participant_id
			);
		}

		if ( ! $event_participant ) {
			return;
		}

		if ( ! $already_signed_up ) {
			$event_participant->label              = 'signed_up';
			$event_participant->payment_expires_at = null;
			$event_participant->ticket_type_id     = ! empty( $signup->ticket_type_id ) ? (int) $signup->ticket_type_id : null;
			$event_participant->save();
		}

		if ( ! empty( $option_ids ) && class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
			$options = array();
			foreach ( $option_ids as $option_id ) {
				$option = \FairEventsExperimental\Models\TicketOption::get_by_id( $option_id );
				if ( $option ) {
					$options[] = $option;
				}
			}
			$event_participant_repository->add_options( (int) $event_participant->id, $options );
		}

		$ledger = new EventParticipantTransactionRepository();
		$ledger->record( (int) $event_participant->id, (int) $transaction->id, 'charge' );

		// The free path emails its confirmation inline in link_participant();
		// a paid signup only reaches "confirmed" here, so this is the sole
		// place a base-route paid signup's confirmation email gets sent.
		\FairAudience\Hooks\PaymentHooks::send_signup_confirmation_email( $event_participant, $transaction );
	}

	/**
	 * Check whether restoring an elapsed hold would exceed configured capacity.
	 *
	 * @param object                     $signup     Historical signup row.
	 * @param int[]                      $option_ids Selected activity IDs.
	 * @param EventParticipantRepository $repository Capacity repository.
	 * @return bool
	 */
	private static function late_confirmation_exceeds_capacity( $signup, array $option_ids, EventParticipantRepository $repository ) {
		if ( class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_date = \FairEvents\Models\EventDates::get_by_id( (int) $signup->event_date_id );
			if ( $event_date && null !== $event_date->capacity
				&& $repository->count_active_for_event_date( (int) $signup->event_date_id ) >= (int) $event_date->capacity
			) {
				return true;
			}
		}

		if ( ! empty( $signup->ticket_type_id ) && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_type = \FairEvents\Models\TicketType::get_by_id( (int) $signup->ticket_type_id );
			if ( $ticket_type && null !== $ticket_type->capacity
				&& $repository->count_signups_for_ticket_type( (int) $signup->ticket_type_id ) >= (int) $ticket_type->capacity
			) {
				return true;
			}
		}

		if ( class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
			foreach ( $option_ids as $option_id ) {
				$option = \FairEventsExperimental\Models\TicketOption::get_by_id( $option_id );
				if ( $option && null !== $option->capacity
					&& $repository->count_signups_for_ticket_option( $option_id ) >= (int) $option->capacity
				) {
					return true;
				}
			}
		}

		return false;
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
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
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
