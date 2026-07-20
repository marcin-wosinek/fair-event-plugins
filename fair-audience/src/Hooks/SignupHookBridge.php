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

defined( 'WPINC' ) || die;

/**
 * Bridges the base fair-events signup render/create path to fair-audience's
 * participant records for the simple (anonymous/linked, non-invitation,
 * non-group-restricted) signup case. The identity routes (/status, /resume,
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
		add_action( 'fair_events_signup_created', array( static::class, 'link_participant' ), 10, 6 );
		add_action( 'fair_events_signup_confirmed', array( static::class, 'handle_signup_confirmed' ), 10, 2 );
		add_action( 'fair_events_signup_payment_failed', array( static::class, 'handle_signup_payment_failed' ), 10, 2 );
		add_action( 'fair_events_backfill_signup_participant_ids', array( static::class, 'backfill_signup_participant_ids' ) );
	}

	/**
	 * Inject the signed-in/known viewer's name and email into the base
	 * form's pre-fill so returning participants don't retype them.
	 *
	 * @param array $context Render context from fair-events' base render.
	 * @return array Filtered context.
	 */
	public static function enrich_render_context( $context ) {
		$participant_repository = new ParticipantRepository();
		$participant            = null;

		$participant_id = AudienceSession::get_participant_id();
		if ( $participant_id ) {
			$participant = $participant_repository->get_by_id( $participant_id );
		} elseif ( get_current_user_id() ) {
			$participant = $participant_repository->get_by_user_id( get_current_user_id() );
		}

		if ( $participant ) {
			$context['prefill_name']  = trim( $participant->name . ' ' . $participant->surname );
			$context['prefill_email'] = (string) $participant->email;
		}

		return $context;
	}

	/**
	 * Create or link the Participant + EventParticipant records for a signup
	 * created through the base fair-events/v1/get-tickets route, set the
	 * session cookie, and send the confirmation email — mirroring the simple
	 * path of EventSignupController::create_signup() without duplicating its
	 * invitation/group/sliding-scale/questionnaire handling.
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
