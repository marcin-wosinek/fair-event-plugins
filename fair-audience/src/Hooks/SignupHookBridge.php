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
use FairAudience\Services\ParticipantToken;
use FairAudience\Services\PendingSignupStash;
use FairAudience\Services\SignupActivities;
use FairAudience\Services\SignupPriceResolver;
use FairAudience\Services\TicketActivities;
use FairAudience\Services\TicketOperations;
use FairAudience\Services\TransactionParticipantLink;

defined( 'WPINC' ) || die;

/**
 * Bridges the base fair-events signup render/create path to fair-audience's
 * participant records for the simple (anonymous/linked, non-group-restricted)
 * signup case. Resuming a signup from an emailed link, cancelling one and
 * adding activities stay on fair-audience/v1 (EventSignupController).
 */
class SignupHookBridge {
	// Named locks intentionally use direct, non-cacheable database calls.
	// phpcs:disable WordPress.DB.DirectDatabaseQuery

	/**
	 * Initialize hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_filter( 'fair_events_signup_viewer_context', array( static::class, 'enrich_render_context' ), 10, 1 );
		add_action( 'fair_events_signup_render_existing_signup', array( static::class, 'render_existing_signup' ), 10, 1 );
		add_action( 'fair_events_signup_render_before_form', array( static::class, 'render_signed_up_card' ), 10, 1 );
		add_action( 'fair_events_signup_render_before_form', array( static::class, 'render_buy_another' ), 10, 1 );
		add_action( 'fair_events_signup_render_before_form', array( static::class, 'render_not_you' ), 10, 1 );
		add_action( 'fair_events_signup_render_before_form', array( static::class, 'render_identity_actions' ), 10, 1 );
		add_action( 'fair_events_signup_render_before_form', array( static::class, 'render_resume_marker' ), 10, 1 );
		add_action( 'fair_events_signup_render_before_submit', array( static::class, 'render_discount_note' ), 10, 1 );
		add_filter( 'fair_events_signup_deferred_response', array( static::class, 'defer_recognised_email' ), 10, 4 );
		add_filter( 'fair_events_signup_ticket_type_error', array( static::class, 'filter_ticket_type_error' ), 10, 5 );
		add_filter( 'fair_events_signup_unit_price', array( static::class, 'filter_unit_price' ), 10, 5 );
		add_filter( 'fair_events_signup_option_prices', array( static::class, 'filter_option_prices' ), 10, 4 );
		add_action( 'fair_events_signup_render_after_form', array( static::class, 'render_add_activities' ), 10, 1 );
		add_filter( 'fair_events_signup_transaction_participant_id', array( static::class, 'filter_transaction_participant_id' ), 10, 5 );
		add_action( 'fair_events_signup_created', array( static::class, 'link_participant' ), 10, 8 );
		add_action( 'fair_events_signup_transaction_created', array( static::class, 'link_transaction' ), 10, 2 );
		add_action( 'fair_events_signup_confirmed', array( static::class, 'handle_signup_confirmed' ), 10, 2 );
		add_action( 'fair_events_signup_payment_failed', array( static::class, 'handle_signup_payment_failed' ), 10, 2 );
		add_action( 'fair_events_backfill_signup_participant_ids', array( static::class, 'backfill_signup_participant_ids' ) );
		add_filter( 'fair_events_capacity_legacy_admissions', array( static::class, 'filter_legacy_admissions' ), 10, 3 );
		add_filter( 'fair_events_capacity_legacy_activity_selections', array( static::class, 'filter_legacy_activity_selections' ), 10, 4 );
		add_action( 'fair_events_signup_moved', array( static::class, 'handle_signup_moved' ), 10, 2 );
		add_action( 'fair_events_signup_ticket_type_changed', array( static::class, 'handle_signup_ticket_type_changed' ), 10, 1 );
	}

	/**
	 * Follow an administrator's move of a signup to another occurrence:
	 * move the participant's relationship with it, so the Audience tab
	 * matches the List. A relationship the participant still needs for
	 * another active signup on the source date stays; one already on the
	 * target date is kept instead of creating a duplicate. Hooked on
	 * fair_events_signup_moved.
	 *
	 * @param object $signup             Signup row after the move.
	 * @param int    $from_event_date_id Event date the signup was on.
	 * @return void
	 */
	public static function handle_signup_moved( $signup, $from_event_date_id ) {
		$participant_id     = (int) ( $signup->participant_id ?? 0 );
		$from_event_date_id = (int) $from_event_date_id;
		$to_event_date_id   = (int) $signup->event_date_id;

		self::list_assigned_holders( $signup );

		if ( ! $participant_id
			|| \FairEvents\Models\EventSignup::has_other_active_signup( $from_event_date_id, $participant_id, (int) $signup->id )
		) {
			return;
		}

		$repository = new EventParticipantRepository();
		if ( ! $repository->get_by_event_date_and_participant( $from_event_date_id, $participant_id ) ) {
			return;
		}

		if ( $repository->get_by_event_date_and_participant( $to_event_date_id, $participant_id ) ) {
			$repository->remove_participant_from_event_date( $from_event_date_id, $participant_id );
			return;
		}

		$repository->move_to_event_date( $from_event_date_id, $participant_id, $to_event_date_id );
	}

	/**
	 * Tickets of a moved signup that were assigned to someone else moved
	 * with it. Give each of their holders a relationship on the new date
	 * when they have none, so they are listed in its audience.
	 *
	 * @param object $signup Signup row after the move.
	 * @return void
	 */
	private static function list_assigned_holders( $signup ) {
		if ( ! TicketActivities::available() ) {
			return;
		}

		$repository   = new EventParticipantRepository();
		$purchaser_id = (int) ( $signup->participant_id ?? 0 );
		foreach ( \FairEvents\Models\EventTicket::get_by_signup_id( (int) $signup->id ) as $ticket ) {
			$holder_id = (int) $ticket->holder_participant_id;
			if ( $holder_id
				&& $purchaser_id !== $holder_id
				&& (int) $ticket->event_date_id === (int) $signup->event_date_id
				&& ! in_array( (string) $ticket->status, \FairEvents\Models\EventTicket::INACTIVE_STATUSES, true )
			) {
				$repository->ensure_ticket_holder_relationship( (int) $ticket->event_date_id, $holder_id );
			}
		}
	}

	/**
	 * Follow an administrator's ticket-type change on a signup: give the
	 * participant's relationship on that date the new type, unless another
	 * active signup of theirs on the date still backs the old one. Hooked on
	 * fair_events_signup_ticket_type_changed.
	 *
	 * @param object $signup Signup row after the change.
	 * @return void
	 */
	public static function handle_signup_ticket_type_changed( $signup ) {
		$participant_id = (int) ( $signup->participant_id ?? 0 );
		$event_date_id  = (int) $signup->event_date_id;

		if ( ! $participant_id
			|| \FairEvents\Models\EventSignup::has_other_active_signup( $event_date_id, $participant_id, (int) $signup->id )
		) {
			return;
		}

		( new EventParticipantRepository() )->update_ticket_type_by_event_date( $event_date_id, $participant_id, (int) $signup->ticket_type_id );
	}

	/**
	 * Add admissions that exist only as fair-audience relationships to
	 * fair-events' capacity count. Hooked on
	 * fair_events_capacity_legacy_admissions.
	 *
	 * @param int    $count Admissions reported so far.
	 * @param string $scope 'event_date' or 'ticket_type'.
	 * @param int    $id    Event date ID or ticket type ID.
	 * @return int
	 */
	public static function filter_legacy_admissions( $count, $scope, $id ) {
		return (int) $count + ( new EventParticipantRepository() )->count_admissions_without_signup( (string) $scope, (int) $id );
	}

	/**
	 * Add activity selections recorded per participant rather than per
	 * ticket to fair-events' activity capacity count. Hooked on
	 * fair_events_capacity_legacy_activity_selections.
	 *
	 * @param int   $count            Selections reported so far.
	 * @param int   $ticket_option_id Ticket option ID.
	 * @param int   $event_date_id    Occurrence (event date) ID.
	 * @param int[] $series_ids       Every event date of the occurrence's series.
	 * @return int
	 */
	public static function filter_legacy_activity_selections( $count, $ticket_option_id, $event_date_id, $series_ids = array() ) {
		return (int) $count + ( new EventParticipantRepository() )->count_participant_scope_selections( (int) $ticket_option_id, (int) $event_date_id, (array) $series_ids );
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
		$participant_token = (string) ( $context['participant_token'] ?? '' );
		// The form for another person (#1528) is resolved for nobody: the
		// ticket types, prices and activities below are an anonymous
		// visitor's, whoever the browser is remembered as.
		$identity                          = GroupSignupPricing::resolve_viewer_identity(
			$participant_token,
			array( 'register_another_person' => ! empty( $context['register_another_person'] ) )
		);
		$participant                       = $identity['participant'];
		$participant_id                    = $participant ? (int) $participant->id : null;
		$context['viewer_identity_source'] = $participant ? $identity['source'] : null;

		// Signals the endpoint that a viewer was actually recognised, so it
		// renders the personalized fragments — true whenever prefill applies,
		// even when nothing else about ticket types/pricing changed.
		$context['viewer_resolved']          = (bool) $participant;
		$context['token_identity_validated'] = $participant && 'participant_token' === $identity['source'];

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
			// a per-type tag to.
			$reduced_rule_ids = array_values( array_unique( array_map( static fn( $rule ) => (int) $rule->id, $rule_by_type_id ) ) );
			if ( 1 === count( $reduced_rule_ids ) ) {
				$context['group_discount_rule'] = reset( $rule_by_type_id );
			}
		}

		// Activities (ticket options) are independent of ticket types — an
		// event can sell activities alongside a free, type-less signup — so
		// this runs unconditionally.
		$context = SignupActivities::enrich_render_context( $context, $participant_id );

		$context['suppress_form']        = false;
		$context['is_signed_up']         = false;
		$context['held_tickets']         = array();
		$context['signup_ticket_backed'] = false;

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

			$pass_covers_date = $series_pass && $event_date_row && $event_date_row->start_datetime
				&& strtotime( $event_date_row->start_datetime ) >= strtotime( $series_pass->created_at );
			if ( $pass_covers_date ) {
				$is_signed_up = true;
			}

			$context['is_signed_up'] = $is_signed_up;

			if ( $is_signed_up ) {
				// The form stays: a signed-up participant can buy another
				// ticket for themselves. What they already hold is rendered
				// beside it (render_existing_signup()). Only a fair-events
				// without that slot still gets the card in place of the form.
				$context['suppress_form']          = empty( $context['existing_signup_slot'] );
				$context['signed_up_ticket_label'] = '';

				// The tickets themselves say what the participant holds; the
				// relationship is one per date however many purchases there
				// are, so its ticket type and activities may describe an
				// earlier one. It is the fallback for admissions without
				// ticket units only.
				$context['held_tickets'] = TicketActivities::held_ticket_summaries( $event_date_id, $participant_id, $pass_covers_date ? $master_id_for_pass : null );

				$context['signup_ticket_backed'] = TicketActivities::backs_admission( $event_date_id, $participant_id )
					|| ( $pass_covers_date && TicketActivities::backs_admission( $master_id_for_pass, $participant_id ) );

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
	 * Render what a recognised viewer already holds for this date — their
	 * tickets, then the activities they can add to them — beside the signup
	 * form, which stays available for another purchase. Hooked on
	 * fair_events_signup_render_existing_signup.
	 *
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
	 * @return void
	 */
	public static function render_existing_signup( $context ) {
		self::output_signed_up_card( $context );
		self::output_add_activities( $context );
	}

	/**
	 * Render the signed-up card in place of the suppressed <form>, for a
	 * fair-events that has no slot of its own for it (see
	 * enrich_render_context()'s suppress_form). Hooked on
	 * fair_events_signup_render_before_form.
	 *
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
	 * @return void
	 */
	public static function render_signed_up_card( $context ) {
		if ( ! empty( $context['existing_signup_slot'] ) ) {
			return;
		}

		self::output_signed_up_card( $context );
	}

	/**
	 * Output the card listing the tickets a recognised viewer holds for this
	 * date. The broad "Cancel signup" action is offered only for an
	 * admission without tickets: with tickets it would remove the one
	 * relationship every purchase shares.
	 *
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
	 * @return void
	 */
	private static function output_signed_up_card( $context ) {
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

		$held_tickets = $context['held_tickets'] ?? array();
		if ( $held_tickets ) {
			echo '<p class="fair-events-signed-up-tickets-label">' . esc_html__( 'Your tickets:', 'fair-audience' ) . '</p>';
			echo '<ul class="fair-events-signed-up-tickets">';
			foreach ( $held_tickets as $held_ticket ) {
				echo '<li><strong>' . esc_html( $held_ticket['label'] ) . '</strong>';
				if ( ! empty( $held_ticket['activities'] ) ) {
					echo '<ul>';
					foreach ( $held_ticket['activities'] as $activity_name ) {
						echo '<li>' . esc_html( $activity_name ) . '</li>';
					}
					echo '</ul>';
				}
				echo '</li>';
			}
			echo '</ul>';
		} else {
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
		}

		// Resolve destinations from each occurrence model rather than the
		// current request URL: this markup is commonly rendered by the
		// viewer-context REST endpoint, which must never become a navigation
		// target.
		$occurrences = $context['occurrences_for_picker'] ?? array();
		if ( count( $occurrences ) > 1 ) {
			$options = array();
			foreach ( $occurrences as $occ_row ) {
				$occurrence = \FairEvents\Models\EventDates::get_by_id( (int) $occ_row['id'] );
				$public_url = $occurrence ? $occurrence->get_event_page_url() : null;
				if ( ! $public_url ) {
					continue;
				}
				$occ_label = class_exists( \FairEvents\Helpers\DateRangeFormatter::class )
					? \FairEvents\Helpers\DateRangeFormatter::format( $occ_row['start_datetime'], $occ_row['end_datetime'], $occ_row['all_day'] )
					: $occ_row['start_datetime'];
				if ( ! empty( $occ_row['signed_up'] ) ) {
					$occ_label .= ' — ' . __( 'already signed up', 'fair-audience' );
				}
				$options[] = array(
					'id'       => (int) $occ_row['id'],
					'label'    => $occ_label,
					'url'      => $public_url,
					'selected' => (int) $occ_row['id'] === $event_date_id,
				);
			}
			if ( count( $options ) > 1 ) {
				$select_id = 'fair-events-signed-up-occurrence-' . $event_date_id;
				echo '<div class="form-row fair-events-signed-up-occurrence-picker">';
				echo '<label for="' . esc_attr( $select_id ) . '" class="form-label">' . esc_html__( 'View another date', 'fair-audience' ) . '</label>';
				echo '<select id="' . esc_attr( $select_id ) . '" class="form-input fair-events-occurrence-select fair-events-signed-up-occurrence-select">';
				foreach ( $options as $option ) {
					echo '<option value="' . esc_attr( (string) $option['id'] ) . '" data-event-url="' . esc_url( $option['url'] ) . '"' . ( $option['selected'] ? ' selected' : '' ) . '>' . esc_html( $option['label'] ) . '</option>';
				}
				echo '</select></div>';
			}
		}

		if ( empty( $context['signup_ticket_backed'] ) ) {
			echo '<div class="wp-block-button">';
			echo '<button type="button" class="wp-block-button__link wp-element-button fair-events-cancel-signup-button">';
			echo esc_html__( 'Cancel signup', 'fair-audience' );
			echo '</button>';
			echo '</div>';
		}

		// Beside the form, render_not_you() offers this with the new
		// purchase's identity instead.
		if ( ! empty( $context['suppress_form'] ) && 'audience_session' === ( $context['viewer_identity_source'] ?? null ) ) {
			echo '<button type="button" class="fair-events-not-you-button">'
				. esc_html__( 'Not you? Start fresh', 'fair-audience' )
				. '</button>';
		}

		if ( self::offers_register_another_person( $context ) ) {
			echo '<button type="button" class="fair-events-register-another-button">'
				. esc_html__( 'Register another person', 'fair-audience' )
				. '</button>';
		}

		echo '</div>';
	}

	/**
	 * Whether the card of tickets held offers registering another person
	 * (#1528): a fresh form for someone else, which leaves the viewer's own
	 * session and tickets as they are. Offered only to a viewer the browser
	 * merely remembers — a signed participant link or a signed-in account,
	 * with or without a participant of its own, always acts as that
	 * participant — who holds a ticket here, and only when fair-events has a
	 * form to open for it.
	 *
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
	 * @return bool
	 */
	private static function offers_register_another_person( $context ) {
		return ! empty( $context['register_another_person_slot'] )
			&& empty( $context['suppress_form'] )
			&& ! empty( $context['signup_ticket_backed'] )
			&& 'audience_session' === ( $context['viewer_identity_source'] ?? null )
			&& ! is_user_logged_in();
	}

	/**
	 * Head the form of a recognised viewer who already holds a ticket: the
	 * purchase it starts is another ticket for the same participant, named
	 * here so it is not taken for registering someone else. Hooked on
	 * fair_events_signup_render_before_form.
	 *
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
	 * @return void
	 */
	public static function render_buy_another( $context ) {
		if ( empty( $context['is_signed_up'] ) || ! empty( $context['suppress_form'] ) ) {
			return;
		}

		$name  = trim( (string) ( $context['prefill_name'] ?? '' ) );
		$email = trim( (string) ( $context['prefill_email'] ?? '' ) );

		echo '<div class="fair-events-buy-another">';
		echo '<h3 class="fair-events-buy-another-heading">' . esc_html__( 'Buy another ticket for yourself', 'fair-audience' ) . '</h3>';

		if ( '' !== $name && '' !== $email ) {
			echo '<p class="fair-events-buy-another-identity">';
			printf(
				/* translators: 1: participant name, 2: participant email address */
				esc_html__( 'You are buying as %1$s (%2$s).', 'fair-audience' ),
				'<strong>' . esc_html( $name ) . '</strong>', // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- pre-escaped substitution.
				esc_html( $email )
			);
			echo '</p>';
		} elseif ( '' !== $name || '' !== $email ) {
			echo '<p class="fair-events-buy-another-identity">';
			printf(
				/* translators: %s: participant name or email address */
				esc_html__( 'You are buying as %s.', 'fair-audience' ),
				'<strong>' . esc_html( '' !== $name ? $name : $email ) . '</strong>' // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- pre-escaped substitution.
			);
			echo '</p>';
		}

		echo '</div>';
	}

	/**
	 * Fire the slot for further identity actions of a recognised viewer's
	 * form, after "Not you? Start fresh". "Register another person" is not
	 * one of them: it is offered on the card of tickets held (see
	 * offers_register_another_person()), apart from the form that buys
	 * another ticket for oneself. Hooked on
	 * fair_events_signup_render_before_form.
	 *
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
	 * @return void
	 */
	public static function render_identity_actions( $context ) {
		if ( ! empty( $context['suppress_form'] ) || empty( $context['viewer_resolved'] ) ) {
			return;
		}

		/**
		 * Fires inside a recognised viewer's signup form, after the identity
		 * reset action.
		 *
		 * @param array $context Viewer context, see fair_events_signup_viewer_context.
		 */
		do_action( 'fair_audience_signup_identity_actions', $context );
	}

	/**
	 * Render the "Not you? Start fresh" button for a viewer recognised only
	 * via the session cookie (not signed up, form not suppressed) — lets them
	 * clear the pre-filled name/email and register as someone else. Hooked on
	 * fair_events_signup_render_before_form; wired client-side against the
	 * existing DELETE /fair-audience/v1/session route by fair-events-shared's
	 * wireNotYouButton().
	 *
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
	 * @return void
	 */
	public static function render_not_you( $context ) {
		if ( ! empty( $context['suppress_form'] ) || empty( $context['prefill_email'] ) ) {
			return;
		}
		if ( 'audience_session' !== ( $context['viewer_identity_source'] ?? null ) ) {
			return;
		}

		echo '<button type="button" class="fair-events-not-you-button">'
			. esc_html__( 'Not you? Start fresh', 'fair-audience' )
			. '</button>';
	}

	/**
	 * Tell the unified form where a visitor arriving from an emailed link can
	 * fetch the submission stashed for them (see defer_recognised_email()).
	 * Emitted only for an identity a valid participant token proved, so it is
	 * never part of the cached page. Hooked on
	 * fair_events_signup_render_before_form.
	 *
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
	 * @return void
	 */
	public static function render_resume_marker( $context ) {
		if ( empty( $context['token_identity_validated'] ) || ! empty( $context['suppress_form'] ) ) {
			return;
		}

		echo '<div hidden data-resume-route="/fair-audience/v1/event-signup/resume"></div>';
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
	 * @param int           $event_date_id Event date ID (unused).
	 * @param string        $participant_token Optional request token.
	 * @param array         $request_context   What the request says about itself: 'register_another_person' (bool).
	 * @return \WP_Error|null
	 */
	public static function filter_ticket_type_error( $error, $ticket_type_id, $event_date_id = 0, $participant_token = '', $request_context = array() ) {
		if ( is_wp_error( $error ) ) {
			return $error;
		}

		$participant = GroupSignupPricing::resolve_viewer_participant( $participant_token, (array) $request_context );
		return GroupSignupPricing::restriction_error( $ticket_type_id, $participant ? (int) $participant->id : null );
	}

	/**
	 * Re-resolve a ticket type's unit price through the viewer's group
	 * discounts. Hooked on fair_events_signup_unit_price.
	 *
	 * @param float|null $unit_price     Base unit price, or null when not purchasable.
	 * @param int        $ticket_type_id Ticket type ID.
	 * @param int        $event_date_id Event date ID (unused).
	 * @param string     $participant_token Optional request token.
	 * @param array      $request_context   What the request says about itself: 'register_another_person' (bool).
	 * @return float|null
	 */
	public static function filter_unit_price( $unit_price, $ticket_type_id, $event_date_id = 0, $participant_token = '', $request_context = array() ) {
		if ( null === $unit_price ) {
			return $unit_price;
		}

		$participant    = GroupSignupPricing::resolve_viewer_participant( $participant_token, (array) $request_context );
		$participant_id = $participant ? (int) $participant->id : null;

		$resolved = SignupPriceResolver::resolve_price_for_ticket_type( $ticket_type_id, $participant_id );
		if ( null === $resolved ) {
			return $unit_price;
		}

		return max( 0, $resolved );
	}

	/**
	 * Apply the viewer's best group discount rule to the base activity prices
	 * fair-events resolved. fair-events builds the line items from the
	 * returned prices, so nothing is charged twice. Hooked on
	 * fair_events_signup_option_prices.
	 *
	 * @param array<int, float> $prices                Base prices, keyed by option ID.
	 * @param int               $pricing_event_date_id Event date the activity catalogue belongs to.
	 * @param string            $participant_token     Optional request token.
	 * @param array             $request_context       What the request says about itself: 'register_another_person' (bool).
	 * @return array<int, float> Prices for this viewer, same keys.
	 */
	public static function filter_option_prices( $prices, $pricing_event_date_id, $participant_token = '', $request_context = array() ) {
		if ( empty( $prices ) ) {
			return $prices;
		}

		$participant = GroupSignupPricing::resolve_viewer_participant( $participant_token, (array) $request_context );

		return SignupActivities::resolve_prices_for_participant( (array) $prices, (int) $pricing_event_date_id, $participant ? (int) $participant->id : null );
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
		// With a slot for what the viewer already holds, the section is
		// rendered there (render_existing_signup()), outside the form.
		if ( ! empty( $context['existing_signup_slot'] ) ) {
			return;
		}

		self::output_add_activities( $context );
	}

	/**
	 * Output the "add activities" section.
	 *
	 * @param array $context Context, see fair_events_signup_viewer_context /
	 *                       enrich_render_context() above.
	 * @return void
	 */
	private static function output_add_activities( $context ) {
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

		// The card above already lists each held ticket with its activities.
		if ( empty( $context['held_tickets'] ) && ! empty( $context['current_activity_names'] ) ) {
			echo '<p>' . esc_html__( 'Your activities:', 'fair-audience' ) . '</p><ul>';
			foreach ( $context['current_activity_names'] as $activity_name ) {
				echo '<li>' . esc_html( $activity_name ) . '</li>';
			}
			echo '</ul>';
		}

		$addon_tickets = $context['addon_tickets'] ?? array();
		if ( count( $addon_tickets ) > 1 ) {
			$select_id = 'fair-events-add-ticket-' . $event_date_id;
			echo '<div class="form-row fair-events-add-activities-ticket">';
			echo '<label for="' . esc_attr( $select_id ) . '" class="form-label">' . esc_html__( 'Add to ticket', 'fair-audience' ) . '</label>';
			echo '<select id="' . esc_attr( $select_id ) . '" name="add_ticket_id" class="form-input" required>';
			echo '<option value="">' . esc_html__( 'Choose a ticket', 'fair-audience' ) . '</option>';
			foreach ( $addon_tickets as $addon_ticket ) {
				echo '<option value="' . esc_attr( (string) $addon_ticket['id'] ) . '">' . esc_html( $addon_ticket['label'] ) . '</option>';
			}
			echo '</select></div>';
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
	 * Hold back a signup whose email belongs to an existing participant the
	 * browser is not known to be. Nothing is saved for that participant and
	 * no session is opened; the submission is stashed and a single-use link
	 * goes to the address, so only whoever reads that inbox can continue.
	 * A valid participant token or a signed-in account with a participant
	 * is the buyer already (see resolve_buyer()), whatever email was typed.
	 * A request registering another person (#1528) is known to be nobody, so
	 * every existing participant's email is held back — the remembered
	 * visitor's own included.
	 * Hooked on fair_events_signup_deferred_response.
	 *
	 * @param array|null $response          Response from an earlier filter.
	 * @param array      $submission        Sanitized submission from fair-events.
	 * @param string     $participant_token Optional request token.
	 * @param array      $request_context   What the request says about itself: 'register_another_person' (bool).
	 * @return array|null Response to send instead of saving, or null to proceed.
	 */
	public static function defer_recognised_email( $response, $submission, $participant_token = '', $request_context = array() ) {
		if ( null !== $response ) {
			return $response;
		}

		$email = (string) ( $submission['email'] ?? '' );
		if ( '' === $email || ! is_email( $email ) || ! class_exists( \FairEvents\Models\EventDates::class ) ) {
			return null;
		}

		$participant = ( new ParticipantRepository() )->get_by_email( $email );
		if ( ! $participant ) {
			return null;
		}

		$identity = GroupSignupPricing::resolve_viewer_identity( (string) $participant_token, (array) $request_context );
		if ( $identity['participant'] ) {
			if ( 'audience_session' !== $identity['source'] || (int) $identity['participant']->id === (int) $participant->id ) {
				return null;
			}
		}

		$event_date_id = (int) ( $submission['event_date_id'] ?? 0 );
		$event_date    = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		$event_id      = $event_date ? (int) $event_date->get_resolved_event_id() : 0;
		$event         = $event_id ? get_post( $event_id ) : null;
		if ( ! $event ) {
			return null;
		}

		$ticket_type_id = (int) ( $submission['ticket_type_id'] ?? 0 );
		$resume_token   = PendingSignupStash::stash(
			array(
				'participant_id'        => (int) $participant->id,
				'event_id'              => $event_id,
				'event_date_id'         => $event_date_id,
				'name'                  => (string) ( $submission['name'] ?? '' ),
				'ticket_type_id'        => $ticket_type_id ? $ticket_type_id : null,
				'ticket_option_ids'     => array_map( 'absint', (array) ( $submission['ticket_option_ids'] ?? array() ) ),
				'ticket_activities'     => array_map(
					static function ( $selection ) {
						return array_map( 'absint', (array) $selection );
					},
					array_values( (array) ( $submission['ticket_activities'] ?? array() ) )
				),
				'event_date_ids'        => array_map( 'absint', (array) ( $submission['event_date_ids'] ?? array() ) ),
				'quantity'              => max( 1, (int) ( $submission['quantity'] ?? 1 ) ),
				'chosen_amount'         => null,
				'keep_informed'         => ! empty( $submission['mailing_opt_in'] ),
				'questionnaire_answers' => (array) ( $submission['questionnaire_answers'] ?? array() ),
			)
		);

		$page_url = $event_date->get_event_page_url();
		if ( ! $page_url ) {
			$page_url = get_permalink( $event_id );
		}
		$resume_url = add_query_arg(
			array(
				'participant_token' => ParticipantToken::generate( (int) $participant->id, $event_date_id ),
				'resume'            => $resume_token,
			),
			$page_url
		);

		$is_paid = SignupPriceResolver::has_paid_price_configured( $event_date_id, $ticket_type_id ? $ticket_type_id : null );
		( new EmailService() )->send_resume_registration_email( $event, $participant, $resume_url, $is_paid );

		return array(
			'success' => true,
			'status'  => 'email_recognized',
			'message' => __( 'We recognise this email — check your inbox to continue.', 'fair-audience' ),
		);
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
	 * @param string   $participant_token Optional request token.
	 * @param array    $request_context  What the request says about itself: 'register_another_person' (bool).
	 * @return void
	 */
	public static function link_participant( $signup_id, $event_date_id, $name, $email, $ticket_selection, $transaction_id, $participant_token = '', $request_context = array() ) {
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

		$request_context    = (array) $request_context;
		$participant        = self::resolve_buyer( $email, $participant_token, $request_context );
		$mailing_opt_in     = ! empty( $ticket_selection['mailing_opt_in'] );
		$is_new_participant = false;

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
		$stamp_metadata       = false;
		$event_participant_id = $existing ? (int) $existing->id : 0;

		if ( $existing ) {
			// A purchase awaiting payment never replaces a role the buyer
			// already has for another reason: a failed or abandoned payment
			// would otherwise take it away with the expired hold.
			$keeps_role = 'signed_up' === $existing->label
				|| ( 'pending_payment' === $label && self::has_standing_role( $existing ) );
			if ( ! $keeps_role ) {
				$event_participant_repository->update_label_by_event_date( $event_date_id, $participant->id, $label );
				$stamp_metadata = true;
			}
		} else {
			$event_participant_id = (int) $event_participant_repository->add_participant_to_event( $event_id, $participant->id, $label, $event_date_id );
			$stamp_metadata       = true;
		}

		// Only stamp ticket/payment metadata when this call created the junction row
		// or upgraded it from a non-signed_up label, so a later signed_up
		// relationship never gets clobbered by an unrelated purchase.
		if ( $stamp_metadata ) {
			$relationship = $event_participant_repository->get_by_event_date_and_participant( $event_date_id, $participant->id );
			if ( $relationship ) {
				$relationship->ticket_type_id = $ticket_type_id;
				if ( $transaction_id ) {
					$relationship->payment_expires_at = gmdate( 'Y-m-d H:i:s', time() + 15 * MINUTE_IN_SECONDS );
				}
				$relationship->save();

				// Record the ledger link at creation time, not just on webhook
				// confirmation — mirrors EventSignupController's own creation
				// sites (see #1112).
				if ( $transaction_id ) {
					( new EventParticipantTransactionRepository() )->record( (int) $relationship->id, (int) $transaction_id, 'charge' );
				}
			}
		}

		// fair-events stores the activities chosen for each ticket together
		// with the tickets themselves; the ticket's own status then decides
		// whether they count, so a failed or lapsed payment releases them
		// with it. Only a purchase fair-events did not store them for falls
		// back to attaching them here.
		if ( empty( $ticket_selection['activities_stored'] ) && ! empty( $ticket_selection['ticket_option_ids'] ) && class_exists( \FairEvents\Models\TicketOption::class ) ) {
			$options = array();
			foreach ( $ticket_selection['ticket_option_ids'] as $option_id ) {
				$option = \FairEvents\Models\TicketOption::get_by_id( (int) $option_id );
				if ( $option ) {
					$options[] = $option;
				}
			}
			self::attach_purchase_activities( (int) $signup_id, (int) $event_date_id, (int) $participant->id, $options, $event_participant_repository );
		}

		// Registering another person leaves the browser remembered as who it
		// was: the new participant never takes over its session.
		if ( empty( $request_context['register_another_person'] ) ) {
			AudienceSession::set( (int) $participant->id );
		}

		if ( ! $transaction_id ) {
			// This purchase's own ticket type and activities: the relationship
			// may already describe an earlier purchase for the same date.
			$activity_names = array();
			if ( class_exists( \FairEvents\Models\TicketOption::class ) ) {
				foreach ( (array) ( $ticket_selection['ticket_option_ids'] ?? array() ) as $option_id ) {
					$option = \FairEvents\Models\TicketOption::get_by_id( (int) $option_id );
					if ( $option && '' !== (string) $option->name ) {
						$activity_names[] = (string) $option->name;
					}
				}
			}

			$email_service = new EmailService();
			$event         = get_post( $event_id );
			$email_service->send_signup_payment_confirmation( $participant, $event, null, array_values( array_unique( $activity_names ) ), (int) $event_date_id, (int) $ticket_type_id, $event_participant_id );
		}
	}

	/**
	 * Whether a relationship stands without the purchase being started: a
	 * collaborator, or someone listed who holds a confirmed ticket on its
	 * date, such as one another participant bought and assigned to them.
	 *
	 * @param object $event_participant Existing relationship.
	 * @return bool
	 */
	private static function has_standing_role( $event_participant ) {
		if ( 'collaborator' === $event_participant->label ) {
			return true;
		}

		return 'interested' === $event_participant->label
			&& TicketActivities::available()
			&& (bool) \FairEvents\Models\EventTicket::get_held_on_event_date( (int) $event_participant->event_date_id, (int) $event_participant->participant_id, array( 'confirmed' ) );
	}

	/**
	 * The existing participant a get-tickets buyer is: the trusted viewer
	 * identity, else the participant with the submitted email. Shared by
	 * link_participant() and the transaction's participant, so both name the
	 * same person. A purchase made for another person (#1528) has no viewer
	 * identity, so only the submitted email decides.
	 *
	 * @param string $email             Buyer email.
	 * @param string $participant_token Optional request token.
	 * @param array  $request_context   What the request says about itself: 'register_another_person' (bool).
	 * @return Participant|null
	 */
	private static function resolve_buyer( $email, $participant_token = '', array $request_context = array() ) {
		$participant = GroupSignupPricing::resolve_viewer_participant( (string) $participant_token, $request_context );
		if ( ! $participant ) {
			$participant = ( new ParticipantRepository() )->get_by_email( $email );
		}

		return $participant;
	}

	/**
	 * Name the participant a get-tickets transaction is created for, so the
	 * connector's general email lookup cannot pick a different one. Signups
	 * that already carry a participant (a retry) decide it; a new purchase
	 * uses the buyer link_participant() is about to resolve. A first-time
	 * buyer has none yet and is linked by link_transaction() once created.
	 * Hooked on fair_events_signup_transaction_participant_id.
	 *
	 * @param int|null $participant_id    Participant ID from an earlier filter.
	 * @param int[]    $signup_ids        Signup rows the transaction pays for.
	 * @param string   $email             Buyer email.
	 * @param string   $participant_token Optional request token.
	 * @param array    $request_context   What the request says about itself: 'register_another_person' (bool).
	 * @return int|null
	 */
	public static function filter_transaction_participant_id( $participant_id, $signup_ids, $email, $participant_token = '', $request_context = array() ) {
		if ( null !== $participant_id || ! TransactionParticipantLink::available() ) {
			return $participant_id;
		}

		$signups = TransactionParticipantLink::load_signups( (array) $signup_ids );
		if ( ! $signups ) {
			return null;
		}

		foreach ( $signups as $signup ) {
			if ( ! empty( $signup->participant_id ) ) {
				$signup_participant_id = TransactionParticipantLink::participant_for_signups( $signups );
				return $signup_participant_id ? $signup_participant_id : null;
			}
		}

		if ( empty( $email ) || ! is_email( $email ) ) {
			return null;
		}

		$participant = self::resolve_buyer( $email, $participant_token, (array) $request_context );
		return $participant ? (int) $participant->id : null;
	}

	/**
	 * Link a get-tickets transaction to the participant its signups now
	 * carry, and record it on their registrations. Hooked on
	 * fair_events_signup_transaction_created, which fires after
	 * link_participant() ran for every signup of the purchase or retry.
	 *
	 * @param int   $transaction_id fair-payments-connector transaction ID.
	 * @param int[] $signup_ids     Signup rows the transaction pays for.
	 * @return void
	 */
	public static function link_transaction( $transaction_id, $signup_ids ) {
		if ( ! TransactionParticipantLink::available() ) {
			return;
		}

		$result = TransactionParticipantLink::link( (int) $transaction_id, (array) $signup_ids );

		if ( TransactionParticipantLink::LINKED !== $result && defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( sprintf( 'fair-audience: transaction %d not linked to a participant (%s).', (int) $transaction_id, $result ) );
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

		if ( ! $already_signed_up && ! self::is_active_reservation( $event_participant ) ) {
			global $wpdb;

			$lock_name = 'fair_audience_confirmation_' . (int) $signup->event_date_id;
			$locked    = (int) $wpdb->get_var(
				$wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $lock_name, 5 )
			);

			// The Fair Events signup is already confirmed. Leave the audience
			// relationship unresolved so a repeated notification can retry safely;
			// an unlocked capacity read could assign the wrong warning.
			if ( 1 !== $locked ) {
				return;
			}

			try {
				// Another callback may have completed this relationship while this
				// request waited for the per-event-date lock.
				$event_participant = $event_participant_repository->get_by_event_date_and_participant(
					(int) $signup->event_date_id,
					(int) $signup->participant_id
				);
				$already_signed_up = $event_participant && 'signed_up' === $event_participant->label;

				if ( ! $already_signed_up ) {
					if ( self::late_confirmation_exceeds_capacity( $option_ids, (int) $signup->event_date_id, $event_participant_repository )
						&& class_exists( \FairEvents\Models\EventSignup::class )
						&& method_exists( \FairEvents\Models\EventSignup::class, 'mark_over_capacity' )
					) {
						\FairEvents\Models\EventSignup::mark_over_capacity( (int) $signup->id );
					}
				}

				self::complete_confirmation( $signup, $transaction, $event_participant, $option_ids, $event_participant_repository );
				( new TicketOperations( $event_participant_repository ) )->follow_signup_confirmation( $signup );
			} finally {
				$wpdb->get_var(
					$wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name )
				);
			}
			return;
		}

		self::complete_confirmation( $signup, $transaction, $event_participant, $option_ids, $event_participant_repository );
		( new TicketOperations( $event_participant_repository ) )->follow_signup_confirmation( $signup );
	}

	/**
	 * Persist the participant, activities, ledger link, and notification.
	 *
	 * @param object                     $signup            Confirmed signup row.
	 * @param object                     $transaction       Payment transaction.
	 * @param object|null                $event_participant Existing relationship.
	 * @param int[]                      $option_ids        Selected activity IDs.
	 * @param EventParticipantRepository $repository        Participant repository.
	 * @return void
	 */
	private static function complete_confirmation( $signup, $transaction, $event_participant, array $option_ids, EventParticipantRepository $repository ) {
		if ( ! $event_participant || 'signed_up' !== $event_participant->label ) {
			self::confirm_event_participant( $signup, $event_participant, $repository );
			$event_participant = $repository->get_by_event_date_and_participant(
				(int) $signup->event_date_id,
				(int) $signup->participant_id
			);
		}

		if ( ! $event_participant ) {
			return;
		}

		if ( ! empty( $option_ids ) && class_exists( \FairEvents\Models\TicketOption::class ) ) {
			$options = array();
			foreach ( $option_ids as $option_id ) {
				$option = \FairEvents\Models\TicketOption::get_by_id( $option_id );
				if ( $option ) {
					$options[] = $option;
				}
			}
			self::attach_purchase_activities( (int) $signup->id, (int) $signup->event_date_id, (int) $signup->participant_id, $options, $repository );
		}

		$ledger = new EventParticipantTransactionRepository();
		$ledger->record( (int) $event_participant->id, (int) $transaction->id, 'charge' );

		// The free path emails its confirmation inline in link_participant();
		// a paid signup only reaches "confirmed" here, so this is the sole
		// place a base-route paid signup's confirmation email gets sent.
		self::send_purchase_confirmation( $signup, $event_participant, $transaction );
	}

	/**
	 * Email the confirmation of one paid purchase. The ticket type and
	 * activities come from the purchase's own signup and tickets: the
	 * participant's relationship is shared by every purchase they make for
	 * the date, so it may describe an earlier one.
	 *
	 * @param object $signup            Confirmed signup row.
	 * @param object $event_participant The participant's relationship on the signup's date.
	 * @param object $transaction       Payment transaction.
	 * @return void
	 */
	private static function send_purchase_confirmation( $signup, $event_participant, $transaction ) {
		// Without per-ticket activities the relationship is all there is.
		if ( ! TicketActivities::available() ) {
			\FairAudience\Hooks\PaymentHooks::send_signup_confirmation_email( $event_participant, $transaction );
			return;
		}

		$participant = ( new ParticipantRepository() )->get_by_id( (int) $signup->participant_id );
		if ( ! $participant ) {
			return;
		}

		$ticket_ids = array_map(
			static function ( $ticket ) {
				return (int) $ticket->id;
			},
			\FairEvents\Models\EventTicket::get_by_signup_id( (int) $signup->id )
		);

		$activity_names = array();
		foreach ( \FairEvents\Models\EventTicketActivity::get_by_ticket_ids( $ticket_ids ) as $rows ) {
			foreach ( $rows as $row ) {
				if ( ! \FairEvents\Models\EventTicketActivity::is_active_row( $row ) ) {
					continue;
				}
				// Prefer the current option name so renames are reflected;
				// fall back to the name stored with the selection.
				$option           = class_exists( \FairEvents\Models\TicketOption::class )
					? \FairEvents\Models\TicketOption::get_by_id( (int) $row->ticket_option_id )
					: null;
				$activity_names[] = $option && '' !== (string) $option->name ? (string) $option->name : (string) $row->ticket_option_name;
			}
		}

		( new EmailService() )->send_signup_payment_confirmation(
			$participant,
			get_post( $event_participant->event_id ),
			$transaction,
			array_values( array_unique( array_filter( $activity_names ) ) ),
			(int) $signup->event_date_id,
			(int) $signup->ticket_type_id,
			(int) $event_participant->id
		);
	}

	/**
	 * Attach activities chosen with a purchase to the ticket it created, or
	 * to the participant's relationship when the purchase has no single
	 * ticket to hold them. Safe to repeat.
	 *
	 * @param int                        $signup_id      Signup row ID.
	 * @param int                        $event_date_id  Event date ID.
	 * @param int                        $participant_id Participant ID.
	 * @param array                      $options        TicketOption objects.
	 * @param EventParticipantRepository $repository     Participant repository.
	 * @return void
	 */
	private static function attach_purchase_activities( $signup_id, $event_date_id, $participant_id, array $options, EventParticipantRepository $repository ) {
		if ( empty( $options ) ) {
			return;
		}

		if ( TicketActivities::available() ) {
			$tickets = \FairEvents\Models\EventTicket::get_by_signup_id( (int) $signup_id );
			if ( 1 === count( $tickets ) ) {
				\FairEvents\Models\EventTicketActivity::confirm( (int) $tickets[0]->id, $options );
				return;
			}
		}

		$relationship = $repository->get_by_event_date_and_participant( $event_date_id, $participant_id );
		if ( $relationship ) {
			$repository->add_options( (int) $relationship->id, $options );
		}
	}

	/**
	 * Convert an unresolved relationship to signed_up.
	 *
	 * @param object                     $signup            Confirmed signup row.
	 * @param object|null                $event_participant Existing relationship.
	 * @param EventParticipantRepository $repository        Participant repository.
	 * @return void
	 */
	private static function confirm_event_participant( $signup, $event_participant, EventParticipantRepository $repository ) {
		if ( ! $event_participant ) {
			$event_date = class_exists( \FairEvents\Models\EventDates::class )
				? \FairEvents\Models\EventDates::get_by_id( (int) $signup->event_date_id )
				: null;
			if ( ! $event_date ) {
				return;
			}
			$repository->add_participant_to_event(
				(int) $event_date->get_resolved_event_id(),
				(int) $signup->participant_id,
				'signed_up',
				(int) $signup->event_date_id
			);
			$event_participant = $repository->get_by_event_date_and_participant(
				(int) $signup->event_date_id,
				(int) $signup->participant_id
			);
		}

		if ( ! $event_participant ) {
			return;
		}

		$event_participant->label              = 'signed_up';
		$event_participant->payment_expires_at = null;
		$event_participant->ticket_type_id     = ! empty( $signup->ticket_type_id ) ? (int) $signup->ticket_type_id : null;
		$event_participant->save();
	}

	/**
	 * Whether a relationship still owns its UTC payment reservation.
	 *
	 * @param object|null $event_participant Relationship row.
	 * @return bool
	 */
	private static function is_active_reservation( $event_participant ) {
		return $event_participant
			&& 'pending_payment' === $event_participant->label
			&& ! empty( $event_participant->payment_expires_at )
			&& strtotime( $event_participant->payment_expires_at . ' UTC' ) > time();
	}

	/**
	 * Check whether restoring an elapsed hold would exceed an activity's
	 * capacity. Event and ticket-type capacity are rechecked by fair-events
	 * itself, from ticket units, before the signup is confirmed.
	 *
	 * @param int[]                      $option_ids    Selected activity IDs.
	 * @param int                        $event_date_id Occurrence the signup is for.
	 * @param EventParticipantRepository $repository    Capacity repository.
	 * @return bool
	 */
	private static function late_confirmation_exceeds_capacity( array $option_ids, $event_date_id, EventParticipantRepository $repository ) {
		if ( class_exists( \FairEvents\Models\TicketOption::class ) ) {
			foreach ( $option_ids as $option_id ) {
				$option = \FairEvents\Models\TicketOption::get_by_id( $option_id );
				if ( $option && null !== $option->capacity
					&& $repository->count_signups_for_ticket_option( $option_id, $event_date_id ) >= (int) $option->capacity
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
	 * matching their stored email to a fair-audience Participant, then link
	 * their ticket units' purchaser and initial holder.
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

		// Carry the newly matched purchasers onto their ticket units.
		if ( class_exists( \FairEvents\Models\EventTicket::class )
			&& method_exists( \FairEvents\Models\EventTicket::class, 'sync_participants_from_signups' )
		) {
			\FairEvents\Models\EventTicket::sync_participants_from_signups();
		}
	}
}
