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

		$event_participant_repository = new EventParticipantRepository();
		$label                        = $transaction_id ? 'pending_payment' : 'signed_up';

		$existing = $event_participant_repository->get_by_event_date_and_participant( $event_date_id, $participant->id );
		if ( $existing ) {
			if ( 'signed_up' !== $existing->label ) {
				$event_participant_repository->update_label_by_event_date( $event_date_id, $participant->id, $label );
			}
		} else {
			$event_participant_repository->add_participant_to_event( $event_id, $participant->id, $label, $event_date_id );
		}

		AudienceSession::set( (int) $participant->id );

		if ( ! $transaction_id ) {
			$email_service = new EmailService();
			$event         = get_post( $event_id );
			$email_service->send_signup_payment_confirmation( $participant, $event, null, array(), (int) $event_date_id );
		}
	}
}
