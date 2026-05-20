<?php
/**
 * Event Interest REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Models\Participant;
use FairAudience\Services\EmailService;
use FairAudience\Services\ParticipantToken;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for anonymous event-interest signups.
 *
 * Visitors register interest in a specific event without creating an account
 * or buying a ticket. Identity is established by email alone — the explicit
 * product decision is to keep this frictionless, so endpoints are public.
 */
class EventInterestController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-audience/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'event-interest';

	/**
	 * Participant repository instance.
	 *
	 * @var ParticipantRepository
	 */
	private $participant_repository;

	/**
	 * Event participant repository instance.
	 *
	 * @var EventParticipantRepository
	 */
	private $event_participant_repository;

	/**
	 * Rate limit: max requests per email per hour.
	 */
	const RATE_LIMIT_MAX = 5;

	/**
	 * Rate limit window in seconds (1 hour).
	 */
	const RATE_LIMIT_WINDOW = 3600;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->participant_repository       = new ParticipantRepository();
		$this->event_participant_repository = new EventParticipantRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					// Public by design: anonymous interest signup is the
					// explicit feature. Spam mitigated by honeypot + rate limit.
					'permission_callback' => '__return_true',
					'args'                => array(
						'event_id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'email'    => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_email',
							'validate_callback' => function ( $value ) {
								return is_email( $value );
							},
						),
						'name'     => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'honeypot' => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					// Public by design: authorization is the signed token.
					'permission_callback' => '__return_true',
					'args'                => array(
						'token' => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Register interest in an event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$event_id = (int) $request->get_param( 'event_id' );
		$email    = $request->get_param( 'email' );
		$name     = $request->get_param( 'name' ) ?? '';
		$honeypot = $request->get_param( 'honeypot' ) ?? '';

		// Bot-trap: honeypot field should always be empty for real users.
		// Return generic success to avoid revealing the trap.
		if ( '' !== trim( $honeypot ) ) {
			return $this->success_response();
		}

		if ( ! is_email( $email ) ) {
			return new WP_Error(
				'invalid_email',
				__( 'Please enter a valid email address.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Resolve the event date for this event (the junction table is keyed
		// by event_date_id, not event_id).
		$event_date_id = 0;
		if ( class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_dates_obj = \FairEvents\Models\EventDates::get_by_event_id( $event_id );
			if ( $event_dates_obj ) {
				$event_date_id = (int) $event_dates_obj->id;
			}
		}

		if ( $event_date_id <= 0 ) {
			return new WP_Error(
				'event_not_found',
				__( 'This event is not available for interest registration.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		if ( $this->is_rate_limited( $email ) ) {
			return new WP_Error(
				'rate_limited',
				__( 'Too many requests. Please try again later.', 'fair-audience' ),
				array( 'status' => 429 )
			);
		}
		$this->increment_rate_limit( $email );

		// Resolve or create the participant. Identity is the email address —
		// matches the pattern used by MailingSignupController.
		$participant = $this->participant_repository->get_by_email( $email );
		if ( ! $participant ) {
			$participant = new Participant();
			$participant->populate(
				array(
					'name'  => $name,
					'email' => $email,
				)
			);
			if ( ! $participant->save() ) {
				return new WP_Error(
					'creation_failed',
					__( 'Failed to register interest. Please try again.', 'fair-audience' ),
					array( 'status' => 500 )
				);
			}
		}

		// Upsert the EventParticipant row.
		// add_participant_to_event() returns false when the row already exists —
		// for interest signup that is a no-op success: we never want to demote
		// a signed_up / collaborator row back to "interested".
		$this->event_participant_repository->add_participant_to_event(
			$event_id,
			(int) $participant->id,
			'interested',
			$event_date_id
		);

		// Best-effort confirmation email, deferred to a cron tick so a slow or
		// unreachable mail transport can't make this request time out — the row
		// is already saved.
		EmailService::defer(
			'send_event_interest_confirmation',
			array( $participant, $event_id, $event_date_id )
		);

		return $this->success_response();
	}

	/**
	 * Unsubscribe from event interest via tokenized link.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$token = $request->get_param( 'token' );

		$parsed = ParticipantToken::verify( $token );
		if ( ! $parsed ) {
			return new WP_Error(
				'invalid_token',
				__( 'Invalid or expired unsubscribe link.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$participant_id = $parsed['participant_id'];
		$event_date_id  = $parsed['event_date_id'];

		$relationship = $this->event_participant_repository->get_by_event_date_and_participant(
			$event_date_id,
			$participant_id
		);

		// Only delete a row that's still in the 'interested' state. Don't
		// silently strip an upgraded role (signed_up, collaborator) when the
		// same person later bought a ticket — that would be data loss.
		if ( $relationship && 'interested' === $relationship->label ) {
			$relationship->delete();
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'You will no longer receive updates about this event.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Build the generic success response.
	 *
	 * Worded so it doesn't leak whether the email already existed.
	 *
	 * @return WP_REST_Response
	 */
	private function success_response() {
		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'Thanks! We will keep you posted about this event.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Check whether the given email is currently rate-limited.
	 *
	 * @param string $email Email address.
	 * @return bool
	 */
	private function is_rate_limited( $email ) {
		$transient_key = 'fair_audience_interest_' . md5( $email );
		$count         = get_transient( $transient_key );
		return $count && (int) $count >= self::RATE_LIMIT_MAX;
	}

	/**
	 * Increment the rate-limit counter for the given email.
	 *
	 * @param string $email Email address.
	 * @return void
	 */
	private function increment_rate_limit( $email ) {
		$transient_key = 'fair_audience_interest_' . md5( $email );
		$count         = get_transient( $transient_key );
		set_transient(
			$transient_key,
			$count ? (int) $count + 1 : 1,
			self::RATE_LIMIT_WINDOW
		);
	}
}
