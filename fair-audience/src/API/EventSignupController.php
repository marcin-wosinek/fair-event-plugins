<?php
/**
 * Event Signup REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\EventSignupAccessKeyRepository;
use FairAudience\Models\Participant;
use FairAudience\Services\EmailService;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for event signup.
 */
class EventSignupController extends WP_REST_Controller {

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
	protected $rest_base = 'event-signup';

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
	 * Event signup access key repository instance.
	 *
	 * @var EventSignupAccessKeyRepository
	 */
	private $access_key_repository;

	/**
	 * Email service instance.
	 *
	 * @var EmailService
	 */
	private $email_service;

	/**
	 * Rate limit: max requests per email per hour.
	 */
	const RATE_LIMIT_MAX = 3;

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
		$this->access_key_repository        = new EventSignupAccessKeyRepository();
		$this->email_service                = new EmailService();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/event-signup/status
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/status',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_status' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'event_id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'token'    => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/event-signup
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_signup' ),
					'permission_callback' => array( $this, 'create_signup_permissions_check' ),
					'args'                => array(
						'event_id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'token'    => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/event-signup/request-link
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/request-link',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'request_link' ),
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
					),
				),
			)
		);

		// POST /fair-audience/v1/event-signup/register
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/register',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'register_and_signup' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'event_id'      => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'name'          => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'surname'       => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'email'         => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_email',
							'validate_callback' => function ( $value ) {
								return is_email( $value );
							},
						),
						'keep_informed' => array(
							'type'              => 'boolean',
							'required'          => false,
							'default'           => false,
							'sanitize_callback' => 'rest_sanitize_boolean',
						),
					),
				),
			)
		);
	}

	/**
	 * Permission check for signup endpoint.
	 * Requires either logged in user or valid token.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error True if allowed, error otherwise.
	 */
	public function create_signup_permissions_check( $request ) {
		$token   = $request->get_param( 'token' );
		$user_id = get_current_user_id();

		// Allow if user is logged in.
		if ( $user_id ) {
			return true;
		}

		// Allow if valid token provided.
		if ( ! empty( $token ) ) {
			$access_key = $this->access_key_repository->get_by_token( $token );
			if ( $access_key ) {
				return true;
			}
		}

		return new WP_Error(
			'rest_forbidden',
			__( 'You must be logged in or have a valid signup link.', 'fair-audience' ),
			array( 'status' => 401 )
		);
	}

	/**
	 * Get signup status.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_status( $request ) {
		$event_id = $request->get_param( 'event_id' );
		$token    = $request->get_param( 'token' );
		$user_id  = get_current_user_id();

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || 'fair_event' !== $event->post_type ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Determine user state and participant.
		$state        = 'anonymous';
		$participant  = null;
		$is_signed_up = false;

		if ( ! empty( $token ) ) {
			// Token-based access.
			$access_key = $this->access_key_repository->get_by_token( $token );
			if ( $access_key && $access_key->event_id === $event_id ) {
				$state       = 'with_token';
				$participant = $this->participant_repository->get_by_id( $access_key->participant_id );
			}
		} elseif ( $user_id ) {
			// Logged-in user.
			$participant = $this->participant_repository->get_by_user_id( $user_id );
			if ( $participant ) {
				$state = 'linked';
			} else {
				$state = 'not_linked';
			}
		}

		// Check if already signed up.
		if ( $participant ) {
			$event_participant = $this->event_participant_repository->get_by_event_and_participant(
				$event_id,
				$participant->id
			);
			if ( $event_participant && 'signed_up' === $event_participant->label ) {
				$is_signed_up = true;
			}
		}

		$response_data = array(
			'state'        => $state,
			'is_signed_up' => $is_signed_up,
			'event'        => array(
				'id'    => $event_id,
				'title' => $event->post_title,
			),
		);

		// Include participant info if available and not anonymous.
		if ( $participant && 'anonymous' !== $state ) {
			$response_data['participant'] = array(
				'id'      => $participant->id,
				'name'    => $participant->name,
				'surname' => $participant->surname,
				'email'   => $participant->email,
			);
		}

		return rest_ensure_response( $response_data );
	}

	/**
	 * Sign up for event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_signup( $request ) {
		$event_id = $request->get_param( 'event_id' );
		$token    = $request->get_param( 'token' );
		$user_id  = get_current_user_id();

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || 'fair_event' !== $event->post_type ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Get participant based on auth method.
		$participant = null;

		if ( ! empty( $token ) ) {
			$access_key = $this->access_key_repository->get_by_token( $token );
			if ( $access_key && $access_key->event_id === $event_id ) {
				$participant = $this->participant_repository->get_by_id( $access_key->participant_id );
			}
		} elseif ( $user_id ) {
			$participant = $this->participant_repository->get_by_user_id( $user_id );
		}

		if ( ! $participant ) {
			return new WP_Error(
				'no_participant',
				__( 'Could not find your participant profile.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Check if already signed up.
		$existing = $this->event_participant_repository->get_by_event_and_participant(
			$event_id,
			$participant->id
		);

		if ( $existing ) {
			if ( 'signed_up' === $existing->label ) {
				return rest_ensure_response(
					array(
						'success' => true,
						'message' => __( 'You are already signed up for this event.', 'fair-audience' ),
						'status'  => 'already_signed_up',
					)
				);
			}

			// Update existing relationship to signed_up.
			$this->event_participant_repository->update_label( $event_id, $participant->id, 'signed_up' );
		} else {
			// Create new signup.
			$this->event_participant_repository->add_participant_to_event( $event_id, $participant->id, 'signed_up' );
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'You have successfully signed up for the event!', 'fair-audience' ),
				'status'  => 'signed_up',
			)
		);
	}

	/**
	 * Request signup link for existing participant.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function request_link( $request ) {
		$event_id = $request->get_param( 'event_id' );
		$email    = $request->get_param( 'email' );

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || 'fair_event' !== $event->post_type ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Validate email.
		if ( ! is_email( $email ) ) {
			return new WP_Error(
				'invalid_email',
				__( 'Please enter a valid email address.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Check rate limit.
		if ( $this->is_rate_limited( $email ) ) {
			return new WP_Error(
				'rate_limited',
				__( 'Too many requests. Please try again later.', 'fair-audience' ),
				array( 'status' => 429 )
			);
		}

		// Increment rate limit counter.
		$this->increment_rate_limit( $email );

		// Find participant by email.
		$participant = $this->participant_repository->get_by_email( $email );

		// Always return success to prevent email enumeration.
		// But only send email if participant exists.
		if ( $participant ) {
			// Create or get access key.
			$access_key = $this->access_key_repository->create_for_participant( $event_id, $participant->id );

			if ( $access_key ) {
				// Send signup link email.
				$this->email_service->send_signup_link_email( $event, $participant, $access_key->token );
			}
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'If your email is in our system, you will receive a signup link shortly. Please check your inbox.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Register new participant and sign up for event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function register_and_signup( $request ) {
		$event_id      = $request->get_param( 'event_id' );
		$name          = $request->get_param( 'name' );
		$surname       = $request->get_param( 'surname' );
		$email         = $request->get_param( 'email' );
		$keep_informed = $request->get_param( 'keep_informed' );

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || 'fair_event' !== $event->post_type ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Validate email.
		if ( ! is_email( $email ) ) {
			return new WP_Error(
				'invalid_email',
				__( 'Please enter a valid email address.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Validate name.
		if ( empty( trim( $name ) ) ) {
			return new WP_Error(
				'invalid_name',
				__( 'Please enter your name.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Check rate limit.
		if ( $this->is_rate_limited( $email ) ) {
			return new WP_Error(
				'rate_limited',
				__( 'Too many requests. Please try again later.', 'fair-audience' ),
				array( 'status' => 429 )
			);
		}

		// Increment rate limit counter.
		$this->increment_rate_limit( $email );

		// Check if participant already exists.
		$participant = $this->participant_repository->get_by_email( $email );

		if ( $participant ) {
			// Participant exists - check if already signed up.
			$existing = $this->event_participant_repository->get_by_event_and_participant(
				$event_id,
				$participant->id
			);

			if ( $existing && 'signed_up' === $existing->label ) {
				return rest_ensure_response(
					array(
						'success' => true,
						'message' => __( 'You are already signed up for this event.', 'fair-audience' ),
						'status'  => 'already_signed_up',
					)
				);
			}

			// Sign up existing participant.
			if ( $existing ) {
				$this->event_participant_repository->update_label( $event_id, $participant->id, 'signed_up' );
			} else {
				$this->event_participant_repository->add_participant_to_event( $event_id, $participant->id, 'signed_up' );
			}

			return rest_ensure_response(
				array(
					'success' => true,
					'message' => __( 'You have successfully signed up for the event!', 'fair-audience' ),
					'status'  => 'signed_up',
				)
			);
		}

		// Create new participant.
		$participant = new Participant();
		$participant->populate(
			array(
				'name'          => $name,
				'surname'       => $surname,
				'email'         => $email,
				'email_profile' => $keep_informed ? 'in_the_loop' : 'minimal',
				'status'        => 'confirmed',
			)
		);

		if ( ! $participant->save() ) {
			return new WP_Error(
				'creation_failed',
				__( 'Failed to process registration. Please try again.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Sign up for event.
		$this->event_participant_repository->add_participant_to_event( $event_id, $participant->id, 'signed_up' );

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'You have successfully registered and signed up for the event!', 'fair-audience' ),
				'status'  => 'registered_and_signed_up',
			)
		);
	}

	/**
	 * Check if email is rate limited.
	 *
	 * @param string $email Email address.
	 * @return bool True if rate limited.
	 */
	private function is_rate_limited( $email ) {
		$transient_key = 'fair_audience_event_signup_' . md5( $email );
		$count         = get_transient( $transient_key );

		return $count && (int) $count >= self::RATE_LIMIT_MAX;
	}

	/**
	 * Increment rate limit counter.
	 *
	 * @param string $email Email address.
	 */
	private function increment_rate_limit( $email ) {
		$transient_key = 'fair_audience_event_signup_' . md5( $email );
		$count         = get_transient( $transient_key );

		if ( $count ) {
			set_transient( $transient_key, (int) $count + 1, self::RATE_LIMIT_WINDOW );
		} else {
			set_transient( $transient_key, 1, self::RATE_LIMIT_WINDOW );
		}
	}
}
