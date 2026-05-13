<?php
/**
 * Event Signup REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\EmailConfirmationTokenRepository;
use FairAudience\Models\Participant;
use FairAudience\Services\AudienceSession;
use FairAudience\Services\EmailService;
use FairAudience\Services\ParticipantToken;
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
	 * Email service instance.
	 *
	 * @var EmailService
	 */
	private $email_service;

	/**
	 * Token repository instance.
	 *
	 * @var EmailConfirmationTokenRepository
	 */
	private $token_repository;

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
		$this->email_service                = new EmailService();
		$this->token_repository             = new EmailConfirmationTokenRepository();
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
						'event_id'          => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'event_date_id'     => array(
							'type'              => 'integer',
							'required'          => false,
							'sanitize_callback' => 'absint',
						),
						'participant_token' => array(
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
						'event_id'          => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'event_date_id'     => array(
							'type'              => 'integer',
							'required'          => false,
							'sanitize_callback' => 'absint',
						),
						'ticket_type_id'    => array(
							'type'              => 'integer',
							'required'          => false,
							'sanitize_callback' => 'absint',
						),
						'ticket_option_ids' => array(
							'type'  => 'array',
							'items' => array( 'type' => 'integer' ),
						),
						'participant_token' => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'invitation_token'  => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// DELETE /fair-audience/v1/event-signup
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'cancel_signup' ),
					'permission_callback' => array( $this, 'create_signup_permissions_check' ),
					'args'                => array(
						'event_id'          => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'event_date_id'     => array(
							'type'              => 'integer',
							'required'          => false,
							'sanitize_callback' => 'absint',
						),
						'participant_token' => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/event-signup/retry-payment
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/retry-payment',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'retry_payment' ),
					'permission_callback' => array( $this, 'retry_payment_permissions_check' ),
					'args'                => array(
						'transaction_id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'signature'      => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
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
						'event_id'      => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'event_date_id' => array(
							'type'              => 'integer',
							'required'          => false,
							'default'           => 0,
							'sanitize_callback' => 'absint',
						),
						'email'         => array(
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
						'event_id'          => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'event_date_id'     => array(
							'type'              => 'integer',
							'required'          => false,
							'sanitize_callback' => 'absint',
						),
						'ticket_type_id'    => array(
							'type'              => 'integer',
							'required'          => false,
							'sanitize_callback' => 'absint',
						),
						'ticket_option_ids' => array(
							'type'  => 'array',
							'items' => array( 'type' => 'integer' ),
						),
						'name'              => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'surname'           => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'email'             => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_email',
							'validate_callback' => function ( $value ) {
								return is_email( $value );
							},
						),
						'keep_informed'     => array(
							'type'              => 'boolean',
							'required'          => false,
							'default'           => false,
							'sanitize_callback' => 'rest_sanitize_boolean',
						),
						'invitation_token'  => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_text_field',
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
		$participant_token = $request->get_param( 'participant_token' );
		$user_id           = get_current_user_id();

		// Allow if user is logged in.
		if ( $user_id ) {
			return true;
		}

		// Allow if valid participant token provided.
		if ( ! empty( $participant_token ) ) {
			$token_data = ParticipantToken::verify( $participant_token );
			if ( $token_data ) {
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
		$event_id          = $request->get_param( 'event_id' );
		$participant_token = $request->get_param( 'participant_token' );
		$user_id           = get_current_user_id();

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Resolve event_date_id.
		$event_date_id = $request->get_param( 'event_date_id' ) ?: 0;
		if ( empty( $event_date_id ) && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_dates_obj = \FairEvents\Models\EventDates::get_by_event_id( $event_id );
			if ( $event_dates_obj ) {
				$event_date_id = (int) $event_dates_obj->id;
			}
		}

		// Determine user state and participant.
		$state        = 'anonymous';
		$participant  = null;
		$is_signed_up = false;

		if ( ! empty( $participant_token ) ) {
			// Token-based access via HMAC participant token.
			$token_data = ParticipantToken::verify( $participant_token );
			if ( $token_data ) {
				$state       = 'with_token';
				$participant = $this->participant_repository->get_by_id( $token_data['participant_id'] );
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
			if ( $event_date_id ) {
				$event_participant = $this->event_participant_repository->get_by_event_date_and_participant(
					$event_date_id,
					$participant->id
				);
			} else {
				$event_participant = $this->event_participant_repository->get_by_event_and_participant(
					$event_id,
					$participant->id
				);
			}
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
		$event_id          = $request->get_param( 'event_id' );
		$participant_token = $request->get_param( 'participant_token' );
		$ticket_type_id    = $request->get_param( 'ticket_type_id' ) ?: null;
		$invitation_token  = $request->get_param( 'invitation_token' ) ?: '';
		$user_id           = get_current_user_id();
		$raw_option_ids    = $request->get_param( 'ticket_option_ids' ) ?: array();

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Resolve event_date_id.
		$event_date_id = $request->get_param( 'event_date_id' ) ?: 0;
		if ( empty( $event_date_id ) && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_dates_obj = \FairEvents\Models\EventDates::get_by_event_id( $event_id );
			if ( $event_dates_obj ) {
				$event_date_id = (int) $event_dates_obj->id;
			}
		}

		// Get participant based on auth method.
		$participant = null;

		if ( ! empty( $participant_token ) ) {
			$token_data = ParticipantToken::verify( $participant_token );
			if ( $token_data ) {
				$participant = $this->participant_repository->get_by_id( $token_data['participant_id'] );
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

		// Validate ticket type group restrictions (and invitation tokens for invitation-only types).
		$group_error = $this->validate_ticket_type_group_restriction( $ticket_type_id, $participant->id, $invitation_token );
		if ( is_wp_error( $group_error ) ) {
			return $group_error;
		}

		// Reject sold-out tiers server-side too — the frontend disables them
		// but a stale page or crafted request could still POST a full
		// ticket_type_id.
		$capacity_error = $this->validate_ticket_type_capacity( $ticket_type_id );
		if ( is_wp_error( $capacity_error ) ) {
			return $capacity_error;
		}

		// Check if already signed up.
		if ( $event_date_id ) {
			$existing = $this->event_participant_repository->get_by_event_date_and_participant(
				$event_date_id,
				$participant->id
			);
		} else {
			$existing = $this->event_participant_repository->get_by_event_and_participant(
				$event_id,
				$participant->id
			);
		}

		if ( $existing && 'signed_up' === $existing->label ) {
			AudienceSession::set( (int) $participant->id );
			return rest_ensure_response(
				array(
					'success' => true,
					'message' => __( 'You are already signed up for this event.', 'fair-audience' ),
					'status'  => 'already_signed_up',
				)
			);
		}

		$option_items = $this->load_valid_options( $event_date_id, $raw_option_ids );

		$min_error = $this->validate_minimum_activities( $event_date_id, $option_items );
		if ( is_wp_error( $min_error ) ) {
			return $min_error;
		}

		$paid_response = $this->maybe_start_paid_signup( $event_id, $event_date_id, $participant, $existing, $user_id, $ticket_type_id, $option_items, $invitation_token );
		if ( null !== $paid_response ) {
			if ( ! is_wp_error( $paid_response ) ) {
				AudienceSession::set( (int) $participant->id );
			}
			return $paid_response;
		}

		// Free path: either no price configured, or the price resolved to 0 (e.g. 100% discount).
		if ( $existing ) {
			if ( $event_date_id ) {
				$this->event_participant_repository->update_label_by_event_date( $event_date_id, $participant->id, 'signed_up' );
			} else {
				$this->event_participant_repository->update_label( $event_id, $participant->id, 'signed_up' );
			}
		} else {
			$this->event_participant_repository->add_participant_to_event( $event_id, $participant->id, 'signed_up', $event_date_id );
		}

		$this->snapshot_ticket_type_on_signup( $event_date_id, $participant->id, $ticket_type_id );
		$this->snapshot_options_on_signup( $event_date_id, $participant->id, $option_items );

		$option_names = array_map( fn( $o ) => $o->name, $option_items );
		$this->email_service->send_signup_payment_confirmation( $participant, $event, null, $option_names );

		AudienceSession::set( (int) $participant->id );

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'You have successfully signed up for the event!', 'fair-audience' ),
				'status'  => 'signed_up',
			)
		);
	}

	/**
	 * Validate that a participant is allowed to use a group-restricted ticket type.
	 *
	 * @param int|null $ticket_type_id   Ticket type ID, or null if none selected.
	 * @param int      $participant_id   Participant ID.
	 * @param string   $invitation_token Optional invitation token string.
	 * @return WP_Error|null WP_Error if restricted, null if allowed.
	 */
	private function validate_ticket_type_group_restriction( $ticket_type_id, $participant_id, $invitation_token = '' ) {
		if ( ! $ticket_type_id ) {
			return null;
		}

		// Check if this is an invitation-only ticket type.
		if ( class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
			if ( $ticket_type && $ticket_type->invitation_only ) {
				return $this->validate_invitation_token( $invitation_token, $ticket_type_id, $participant_id );
			}
		}

		if ( ! class_exists( \FairEvents\Models\TicketTypeGroupRestriction::class ) ) {
			return null;
		}

		$allowed_group_ids = \FairEvents\Models\TicketTypeGroupRestriction::get_group_ids_by_ticket_type_id( $ticket_type_id );
		if ( empty( $allowed_group_ids ) ) {
			return null;
		}

		$group_participant_repo = new \FairAudience\Database\GroupParticipantRepository();
		$memberships            = $group_participant_repo->get_by_participant( $participant_id );
		$participant_group_ids  = array_map( fn( $m ) => (int) $m->group_id, $memberships );

		if ( empty( array_intersect( $allowed_group_ids, $participant_group_ids ) ) ) {
			return new WP_Error(
				'ticket_type_restricted',
				__( 'This ticket type is not available for your account.', 'fair-audience' ),
				array( 'status' => 403 )
			);
		}

		return null;
	}

	/**
	 * Reject a ticket type that's already reached its capacity.
	 *
	 * Mirrors the per-option capacity check in load_valid_options(): counts
	 * seats from `signed_up` rows plus unexpired `pending_payment` holds, so
	 * tiers like "Early Bird – first 10" close as soon as the tenth seat is
	 * sold rather than after payment confirmation.
	 *
	 * @param int|null $ticket_type_id Ticket type ID, or null when none selected.
	 * @return WP_Error|null WP_Error if the tier is full, null otherwise.
	 */
	private function validate_ticket_type_capacity( $ticket_type_id ) {
		if ( ! $ticket_type_id || ! class_exists( \FairEvents\Models\TicketType::class ) ) {
			return null;
		}

		$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
		if ( ! $ticket_type || null === $ticket_type->capacity ) {
			return null;
		}

		$reserved = $this->event_participant_repository->count_seats_for_ticket_type( (int) $ticket_type_id );
		if ( $reserved >= (int) $ticket_type->capacity ) {
			return new WP_Error(
				'ticket_type_sold_out',
				__( 'This ticket type is sold out. Please pick another option.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		return null;
	}

	/**
	 * Validate an invitation token for an invitation-only ticket type.
	 *
	 * @param string $invitation_token Invitation token string.
	 * @param int    $ticket_type_id   Ticket type ID.
	 * @param int    $participant_id   Participant ID (the invitee).
	 * @return WP_Error|null WP_Error if invalid, null if valid.
	 */
	private function validate_invitation_token( $invitation_token, $ticket_type_id, $participant_id ) {
		if ( empty( $invitation_token ) || ! class_exists( \FairEvents\Models\InvitationToken::class ) ) {
			return new WP_Error(
				'invitation_required',
				__( 'This ticket type requires an invitation link.', 'fair-audience' ),
				array( 'status' => 403 )
			);
		}

		$token = \FairEvents\Models\InvitationToken::get_by_token( $invitation_token );
		if ( ! $token ) {
			return new WP_Error(
				'invalid_invitation',
				__( 'This invitation link is not valid.', 'fair-audience' ),
				array( 'status' => 403 )
			);
		}

		if ( ! $token->is_valid() ) {
			return new WP_Error(
				'invitation_expired',
				__( 'This invitation link has expired or has been fully used.', 'fair-audience' ),
				array( 'status' => 410 )
			);
		}

		$token->record_use( $participant_id );

		return null;
	}

	/**
	 * Snapshot ticket_type_id + seats onto the EventParticipant row after a
	 * free-path signup. No-op when no ticket type was selected or the row
	 * cannot be found.
	 *
	 * @param int      $event_date_id  Event date ID.
	 * @param int      $participant_id Participant ID.
	 * @param int|null $ticket_type_id Ticket type ID, or null for legacy flows.
	 * @return void
	 */
	private function snapshot_ticket_type_on_signup( $event_date_id, $participant_id, $ticket_type_id ) {
		if ( ! $ticket_type_id || ! $event_date_id ) {
			return;
		}
		if ( ! class_exists( \FairEvents\Models\TicketType::class ) ) {
			return;
		}

		$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
		if ( ! $ticket_type ) {
			return;
		}

		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->update(
			$wpdb->prefix . 'fair_audience_event_participants',
			array(
				'ticket_type_id' => (int) $ticket_type_id,
				'seats'          => max( 1, (int) $ticket_type->seats_per_ticket ),
			),
			array(
				'event_date_id'  => (int) $event_date_id,
				'participant_id' => (int) $participant_id,
			),
			array( '%d', '%d' ),
			array( '%d', '%d' )
		);
	}

	/**
	 * Store the selected ticket options for an event participant (free path).
	 *
	 * @param int   $event_date_id  Event date ID.
	 * @param int   $participant_id Participant ID.
	 * @param array $option_items   Array of TicketOption objects.
	 * @return void
	 */
	private function snapshot_options_on_signup( $event_date_id, $participant_id, $option_items ) {
		if ( empty( $option_items ) || ! $event_date_id ) {
			return;
		}

		$row = $this->event_participant_repository->get_by_event_date_and_participant( $event_date_id, $participant_id );
		if ( ! $row ) {
			return;
		}

		$this->save_participant_options( (int) $row->id, $option_items );
	}

	/**
	 * Enforce the minimum-activities event setting.  When the event date has
	 * no minimum configured (or no options at all), this is a no-op.
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param array $option_items  Validated TicketOption objects selected by the participant.
	 * @return WP_Error|null WP_Error when the minimum is not met, null otherwise.
	 */
	private function validate_minimum_activities( $event_date_id, $option_items ) {
		if ( ! $event_date_id || ! class_exists( \FairEvents\Models\EventDateSetting::class ) ) {
			return null;
		}

		$lookup_id = (int) $event_date_id;
		if ( class_exists( \FairEvents\Models\EventDates::class ) ) {
			$ed = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
			if ( $ed && 'generated' === $ed->occurrence_type && $ed->master_id ) {
				$lookup_id = (int) $ed->master_id;
			}
		}

		$minimum = (int) \FairEvents\Models\EventDateSetting::get( $lookup_id, 'minimum_activities' );
		if ( $minimum <= 0 ) {
			return null;
		}

		if ( count( $option_items ) >= $minimum ) {
			return null;
		}

		return new WP_Error(
			'minimum_activities_not_met',
			sprintf(
				/* translators: %d: minimum number of activities required */
				_n(
					'Please select at least %d activity to sign up.',
					'Please select at least %d activities to sign up.',
					$minimum,
					'fair-audience'
				),
				$minimum
			),
			array( 'status' => 400 )
		);
	}

	/**
	 * Load and validate ticket options by ID, ensuring they belong to the event date.
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param array $option_ids    Array of option IDs from the request.
	 * @return array Array of valid TicketOption objects.
	 */
	private function load_valid_options( $event_date_id, $option_ids ) {
		if ( empty( $option_ids ) || ! $event_date_id ) {
			return array();
		}

		if ( ! class_exists( \FairEvents\Models\TicketOption::class ) ) {
			return array();
		}

		$lookup_id = $event_date_id;
		if ( class_exists( \FairEvents\Models\EventDates::class ) ) {
			$ed = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
			if ( $ed && 'generated' === $ed->occurrence_type && $ed->master_id ) {
				$lookup_id = (int) $ed->master_id;
			}
		}

		$valid_options   = array();
		$available_by_id = array();
		$all_options     = \FairEvents\Models\TicketOption::get_all_by_event_date_id( $lookup_id );
		foreach ( $all_options as $opt ) {
			$available_by_id[ $opt->id ] = $opt;
		}

		foreach ( $option_ids as $id ) {
			$id = absint( $id );
			if ( ! $id || ! isset( $available_by_id[ $id ] ) ) {
				continue;
			}
			$opt = $available_by_id[ $id ];
			if ( null !== $opt->capacity ) {
				$reserved = $this->event_participant_repository->count_seats_for_ticket_option( (int) $opt->id );
				if ( $reserved >= (int) $opt->capacity ) {
					continue;
				}
			}
			$valid_options[] = $opt;
		}

		return $valid_options;
	}

	/**
	 * Resolve the inviter participant ID from a (possibly empty) invitation token.
	 *
	 * Does not record any token use — that is handled by validate_invitation_token
	 * for invitation-only ticket types. Here we only need to read the inviter so
	 * we can apply the activity collaborator discount when relevant.
	 *
	 * @param string $invitation_token Token string from the request.
	 * @param int    $event_date_id    Event date ID for cross-checking the token scope.
	 * @return int|null Inviter participant ID, or null if no valid token applies.
	 */
	private function resolve_invitation_inviter_id( $invitation_token, $event_date_id ) {
		if ( empty( $invitation_token ) || ! class_exists( \FairEvents\Models\InvitationToken::class ) ) {
			return null;
		}
		$token = \FairEvents\Models\InvitationToken::get_by_token( $invitation_token );
		if ( ! $token || ! $token->is_valid() ) {
			return null;
		}
		if ( $event_date_id && (int) $token->event_date_id !== (int) $event_date_id ) {
			return null;
		}
		return (int) $token->inviter_participant_id;
	}

	/**
	 * Compute the effective price for a ticket option, applying activity
	 * collaborator discount first (if eligible) and falling back to the
	 * group pricing rule when no per-activity discount applies.
	 *
	 * @param object      $option                 TicketOption object.
	 * @param int         $event_date_id          Event date ID.
	 * @param int|null    $inviter_participant_id Inviter participant ID resolved from the invitation token.
	 * @param object|null $best_discount_rule     Best group pricing rule for the buyer, if any.
	 * @return float Effective option price (>= 0 inputs assumed; may be 0).
	 */
	private function compute_option_price( $option, $event_date_id, $inviter_participant_id, $best_discount_rule ) {
		if ( class_exists( \FairEvents\Services\EventSignupPricing::class ) ) {
			$invitation_price = \FairEvents\Services\EventSignupPricing::resolve_option_invitation_price(
				$option,
				$event_date_id,
				$inviter_participant_id
			);
			if ( null !== $invitation_price ) {
				return (float) $invitation_price;
			}
		}

		$opt_price = (float) $option->price;
		if ( $best_discount_rule && $opt_price > 0 && class_exists( \FairEvents\Services\EventSignupPricing::class ) ) {
			$opt_price = \FairEvents\Services\EventSignupPricing::apply_discount(
				$opt_price,
				$best_discount_rule->discount_type,
				(float) $best_discount_rule->discount_value
			);
		}
		return $opt_price;
	}

	/**
	 * Insert rows into fair_audience_event_participant_options.
	 *
	 * phpcs:disable WordPress.DB.DirectDatabaseQuery
	 *
	 * @param int   $event_participant_id Event participant record ID.
	 * @param array $option_items         Array of TicketOption objects.
	 * @return void
	 */
	private function save_participant_options( $event_participant_id, $option_items ) {
		global $wpdb;

		if ( empty( $option_items ) ) {
			return;
		}

		$table_name = $wpdb->prefix . 'fair_audience_event_participant_options';

		foreach ( $option_items as $option ) {
			$wpdb->replace(
				$table_name,
				array(
					'event_participant_id' => $event_participant_id,
					'ticket_option_id'     => $option->id,
					'ticket_option_name'   => $option->name,
				),
				array( '%d', '%d', '%s' )
			);
		}
	}

	/**
	 * Start the paid-signup flow when the event date has a positive resolved
	 * price for this participant. Returns null for the free path so the caller
	 * can continue with its normal success response.
	 *
	 * On paid: upserts a `pending_payment` participant row holding a 15-minute
	 * slot, creates a fair-payment transaction linked back to that row via
	 * metadata + transaction_id, and returns the Mollie checkout URL.
	 *
	 * @param int                                        $event_id       Event post ID.
	 * @param int                                        $event_date_id  Event date ID.
	 * @param \FairAudience\Models\Participant           $participant    Participant doing the signup.
	 * @param \FairAudience\Models\EventParticipant|null $existing       Existing row for (event_date, participant), if any.
	 * @param int                                        $user_id        Current WP user ID (0 for anonymous).
	 * @param int|null                                   $ticket_type_id Selected ticket type ID, or null when not using ticket types.
	 * @param array                                      $option_items     Selected TicketOption objects.
	 * @param string                                     $invitation_token Optional invitation token presented by the buyer.
	 * @return \WP_REST_Response|\WP_Error|null WP_REST_Response/WP_Error on paid path, null on free path.
	 */
	private function maybe_start_paid_signup( $event_id, $event_date_id, $participant, $existing, $user_id, $ticket_type_id = null, $option_items = array(), $invitation_token = '' ) {
		$final_price      = null;
		$seats_per_ticket = 1;
		if ( $event_date_id && class_exists( \FairEvents\Services\EventSignupPricing::class ) ) {
			if ( $ticket_type_id ) {
				$final_price = \FairEvents\Services\EventSignupPricing::resolve_price_for_ticket_type( $ticket_type_id, $participant->id );
				if ( class_exists( \FairEvents\Models\TicketType::class ) ) {
					$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
					if ( $ticket_type ) {
						$seats_per_ticket = max( 1, (int) $ticket_type->seats_per_ticket );
					}
				}
			} else {
				$final_price = \FairEvents\Services\EventSignupPricing::resolve_price( $event_date_id, $participant->id );
			}
		}

		// Apply group discount to option prices when the participant qualifies.
		$best_discount_rule = null;
		if ( $event_date_id && class_exists( \FairEvents\Services\EventSignupPricing::class ) ) {
			$best_discount_rule = \FairEvents\Services\EventSignupPricing::resolve_best_discount_rule(
				$event_date_id,
				$participant->id
			);
		}

		$invitation_inviter_id = $this->resolve_invitation_inviter_id( $invitation_token, $event_date_id );

		// Option prices count towards the total even when there is no base price.
		$options_total = 0;
		foreach ( $option_items as $opt ) {
			$options_total += $this->compute_option_price(
				$opt,
				$event_date_id,
				$invitation_inviter_id,
				$best_discount_rule
			);
		}
		$total_amount = (float) ( $final_price ?? 0 ) + $options_total;

		if ( $total_amount <= 0 ) {
			return null;
		}

		if ( ! class_exists( \FairPayment\API\TransactionAPI::class ) ) {
			return new WP_Error(
				'payment_unavailable',
				__( 'Paid signup is not available because the payment plugin is missing.', 'fair-audience' ),
				array( 'status' => 503 )
			);
		}

		$event_date_row = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( $event_date_row && null !== $event_date_row->capacity ) {
			$active_count       = $this->event_participant_repository->count_active_for_event_date( $event_date_id );
			$already_holds_slot = $existing && in_array( $existing->label, array( 'signed_up', 'pending_payment' ), true );
			$held_seats         = $already_holds_slot ? max( 1, (int) $existing->seats ) : 0;
			$projected          = $active_count - $held_seats + $seats_per_ticket;
			if ( $projected > (int) $event_date_row->capacity ) {
				return new WP_Error(
					'event_full',
					__( 'This event is fully booked.', 'fair-audience' ),
					array( 'status' => 409 )
				);
			}
		}

		$expires_at = gmdate( 'Y-m-d H:i:s', time() + 15 * MINUTE_IN_SECONDS );

		if ( $existing ) {
			$existing->label              = 'pending_payment';
			$existing->payment_expires_at = $expires_at;
			$existing->transaction_id     = null;
			$existing->ticket_type_id     = $ticket_type_id ?: null;
			$existing->seats              = $seats_per_ticket;
			$existing->save();
			$event_participant = $existing;
		} else {
			$event_participant = new \FairAudience\Models\EventParticipant(
				array(
					'event_id'           => $event_id,
					'event_date_id'      => $event_date_id,
					'participant_id'     => $participant->id,
					'label'              => 'pending_payment',
					'payment_expires_at' => $expires_at,
					'ticket_type_id'     => $ticket_type_id ?: null,
					'seats'              => $seats_per_ticket,
				)
			);
			$event_participant->save();
		}

		$this->save_participant_options( (int) $event_participant->id, $option_items );

		$line_item_description = sprintf(
			/* translators: %s: event title */
			__( 'Signup for %s', 'fair-audience' ),
			get_the_title( $event_id )
		);

		// Build line items: base price plus each selected option.
		// Negative amounts represent discounts (e.g. solidarity tickets).
		$line_items = array();
		if ( null !== $final_price && 0.0 !== (float) $final_price ) {
			$line_items[] = array(
				'name'     => $line_item_description,
				'quantity' => 1,
				'amount'   => (float) $final_price,
			);
		}
		foreach ( $option_items as $opt ) {
			$opt_price = $this->compute_option_price(
				$opt,
				$event_date_id,
				$invitation_inviter_id,
				$best_discount_rule
			);
			if ( 0.0 !== $opt_price ) {
				$line_items[] = array(
					'name'     => $opt->name,
					'quantity' => 1,
					'amount'   => $opt_price,
				);
			}
		}

		// Persist the buyer's selection on the transaction so retry can
		// rebuild the EventParticipant row (and its options) if the original
		// row has already been cleaned up by the cron.
		$selected_option_ids = array_map(
			static fn( $opt ) => (int) $opt->id,
			$option_items
		);

		$transaction_id = \FairPayment\API\TransactionAPI::create_transaction(
			$line_items,
			array(
				'currency'      => 'EUR',
				'description'   => $line_item_description,
				'post_id'       => $event_id,
				'event_date_id' => $event_date_id,
				'user_id'       => $user_id ? $user_id : null,
				'metadata'      => array(
					'source'               => 'fair-audience-signup',
					'event_date_id'        => $event_date_id,
					'event_participant_id' => $event_participant->id,
					'participant_id'       => $participant->id,
					'ticket_type_id'       => $ticket_type_id ? (int) $ticket_type_id : null,
					'ticket_option_ids'    => $selected_option_ids,
				),
			)
		);

		if ( is_wp_error( $transaction_id ) ) {
			return $transaction_id;
		}

		$event_participant->transaction_id = (int) $transaction_id;
		$event_participant->save();

		$redirect_url = add_query_arg(
			array(
				'fair_payment_callback' => 'true',
				'fair_signup_tx'        => $transaction_id,
				'fst_sig'               => \FairAudience\Services\TransactionAccessToken::generate(
					(int) $transaction_id,
					(int) $participant->id
				),
			),
			get_permalink( $event_id )
		);

		$payment = \FairPayment\API\TransactionAPI::initiate_payment(
			$transaction_id,
			array(
				'redirect_url' => $redirect_url,
			)
		);

		if ( is_wp_error( $payment ) ) {
			return $payment;
		}

		return rest_ensure_response(
			array(
				'success'        => true,
				'status'         => 'payment_required',
				'message'        => __( 'Redirecting to payment…', 'fair-audience' ),
				'checkout_url'   => $payment['checkout_url'],
				'transaction_id' => $transaction_id,
				'amount'         => $total_amount,
				'currency'       => 'EUR',
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
		$event_id      = $request->get_param( 'event_id' );
		$event_date_id = $request->get_param( 'event_date_id' ) ?: 0;
		$email         = $request->get_param( 'email' );

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
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
			// Resolve event_date_id if not provided.
			if ( ! $event_date_id && class_exists( \FairEvents\Models\EventDates::class ) ) {
				$event_dates_obj = \FairEvents\Models\EventDates::get_by_event_id( $event_id );
				if ( $event_dates_obj ) {
					$event_date_id = $event_dates_obj->id;
				}
			}

			// Generate participant token URL.
			$token_url = ParticipantToken::get_url( $participant->id, $event_date_id, $event->ID );

			// Send signup link email.
			$this->email_service->send_signup_link_email( $event, $participant, $token_url );
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'If your email is in our system, you will receive a signup link shortly. Please check your inbox.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Permission check for retry-payment: visitor must own the failed
	 * transaction. Accepts (in order): a valid signature from the Mollie
	 * redirect URL, WP login matching transaction.user_id, linked participant,
	 * or audience session cookie.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error True if allowed, error otherwise.
	 */
	public function retry_payment_permissions_check( $request ) {
		$transaction_id = (int) $request->get_param( 'transaction_id' );
		if ( $transaction_id <= 0 ) {
			return new WP_Error(
				'invalid_transaction',
				__( 'Invalid transaction.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		if ( ! class_exists( \FairPayment\API\TransactionAPI::class ) ) {
			return new WP_Error(
				'payment_unavailable',
				__( 'Payment plugin is missing.', 'fair-audience' ),
				array( 'status' => 503 )
			);
		}

		$transaction = \FairPayment\API\TransactionAPI::get_transaction( $transaction_id );
		if ( ! $transaction ) {
			return new WP_Error(
				'transaction_not_found',
				__( 'Transaction not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$wp_user_id        = get_current_user_id();
		$tx_user_id        = isset( $transaction->user_id ) ? (int) $transaction->user_id : 0;
		$tx_participant_id = isset( $transaction->participant_id ) ? (int) $transaction->participant_id : 0;

		// Mollie-redirect signature: proves the visitor reached this from the
		// link we generated. Lets the buyer retry after their 1h session
		// cookie has expired, without exposing other people's transactions to
		// enumeration.
		$signature = (string) $request->get_param( 'signature' );
		if ( '' !== $signature
			&& $tx_participant_id > 0
			&& \FairAudience\Services\TransactionAccessToken::verify( $signature, $transaction_id, $tx_participant_id )
		) {
			return true;
		}

		if ( $wp_user_id && $tx_user_id && $wp_user_id === $tx_user_id ) {
			return true;
		}

		if ( $tx_participant_id > 0 ) {
			if ( $wp_user_id ) {
				$linked = $this->participant_repository->get_by_user_id( $wp_user_id );
				if ( $linked && (int) $linked->id === $tx_participant_id ) {
					return true;
				}
			}

			$cookie_participant_id = \FairAudience\Services\AudienceSession::get_participant_id();
			if ( $cookie_participant_id && (int) $cookie_participant_id === $tx_participant_id ) {
				return true;
			}
		}

		return new WP_Error(
			'rest_forbidden',
			__( 'You are not authorized to retry this payment.', 'fair-audience' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * Re-initiate payment for a previously failed/canceled/expired transaction.
	 *
	 * The existing EventParticipant.pending_payment row is reused when the
	 * 15-minute hold has not yet elapsed; otherwise the hold is refreshed (or
	 * the row recreated if a cleanup cron already removed it). A new
	 * fair-payment transaction is always created since fair-payment refuses
	 * to re-initiate a transaction once a Mollie payment has been attached.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function retry_payment( $request ) {
		$transaction_id = (int) $request->get_param( 'transaction_id' );

		$old_transaction = \FairPayment\API\TransactionAPI::get_transaction( $transaction_id );
		if ( ! $old_transaction ) {
			return new WP_Error(
				'transaction_not_found',
				__( 'Transaction not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Reject obvious wrong states. 'draft' is allowed only when payment
		// was never initiated (e.g., transient failure during initial signup);
		// 'paid' and 'pending' mean retry does not apply.
		$status = (string) $old_transaction->status;
		if ( 'paid' === $status || 'pending' === $status ) {
			return new WP_Error(
				'invalid_retry_state',
				__( 'This payment cannot be retried.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		$metadata = ! empty( $old_transaction->metadata ) ? json_decode( $old_transaction->metadata, true ) : array();
		if ( empty( $metadata['source'] ) || 'fair-audience-signup' !== $metadata['source'] ) {
			return new WP_Error(
				'invalid_retry_source',
				__( 'This payment is not retriable from this endpoint.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$event_id       = isset( $metadata['post_id'] ) ? (int) $metadata['post_id'] : (int) $old_transaction->post_id;
		$event_date_id  = isset( $metadata['event_date_id'] ) ? (int) $metadata['event_date_id'] : (int) $old_transaction->event_date_id;
		$participant_id = isset( $metadata['participant_id'] ) ? (int) $metadata['participant_id'] : (int) $old_transaction->participant_id;
		$user_id        = isset( $old_transaction->user_id ) ? (int) $old_transaction->user_id : 0;

		if ( ! $event_id || ! $participant_id ) {
			return new WP_Error(
				'invalid_retry_state',
				__( 'This payment is missing context needed to retry.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		$event = get_post( $event_id );
		if ( ! $event ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Look up the EventParticipant row. handle_signup_failed nulls out the
		// transaction_id so get_by_transaction_id may miss; fall back to the
		// (event_date_id, participant_id) pair which is the natural key.
		$event_participant = null;
		if ( $event_date_id ) {
			$event_participant = $this->event_participant_repository->get_by_event_date_and_participant(
				$event_date_id,
				$participant_id
			);
		}
		if ( ! $event_participant ) {
			$event_participant = $this->event_participant_repository->get_by_event_and_participant(
				$event_id,
				$participant_id
			);
		}

		// Reject when the slot is already paid for from another transaction.
		if ( $event_participant && 'signed_up' === $event_participant->label ) {
			return rest_ensure_response(
				array(
					'success' => true,
					'status'  => 'already_signed_up',
					'message' => __( 'You are already signed up for this event.', 'fair-audience' ),
				)
			);
		}

		// Build line items from the old transaction so the retry mirrors the
		// original purchase exactly (same prices the visitor agreed to).
		$old_line_items = \FairPayment\Models\LineItem::get_by_transaction_id( $transaction_id );
		if ( empty( $old_line_items ) ) {
			return new WP_Error(
				'invalid_retry_state',
				__( 'Original line items could not be loaded.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		$line_items = array();
		foreach ( $old_line_items as $li ) {
			$line_items[] = array(
				'name'     => (string) $li->name,
				'quantity' => isset( $li->quantity ) ? (int) $li->quantity : 1,
				'amount'   => (float) $li->unit_amount,
			);
		}

		// Recover the buyer's original selection from transaction metadata so
		// the row + options are restored even when the cleanup cron deleted
		// them since the failed attempt.
		$retry_ticket_type_id = isset( $metadata['ticket_type_id'] ) && $metadata['ticket_type_id']
			? (int) $metadata['ticket_type_id']
			: null;
		$retry_option_ids     = isset( $metadata['ticket_option_ids'] ) && is_array( $metadata['ticket_option_ids'] )
			? array_map( 'intval', $metadata['ticket_option_ids'] )
			: array();

		$retry_seats = 1;
		if ( $retry_ticket_type_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$retry_ticket_type = \FairEvents\Models\TicketType::get_by_id( $retry_ticket_type_id );
			if ( $retry_ticket_type ) {
				$retry_seats = max( 1, (int) $retry_ticket_type->seats_per_ticket );
			}
		}

		// Refresh / acquire the 15-minute hold for this retry attempt.
		$expires_at = gmdate( 'Y-m-d H:i:s', time() + 15 * MINUTE_IN_SECONDS );

		if ( $event_participant ) {
			$event_participant->label              = 'pending_payment';
			$event_participant->payment_expires_at = $expires_at;
			$event_participant->transaction_id     = null;
			$event_participant->ticket_type_id     = $retry_ticket_type_id;
			$event_participant->seats              = $retry_seats;
			$event_participant->save();
		} else {
			$event_participant = new \FairAudience\Models\EventParticipant(
				array(
					'event_id'           => $event_id,
					'event_date_id'      => $event_date_id,
					'participant_id'     => $participant_id,
					'label'              => 'pending_payment',
					'payment_expires_at' => $expires_at,
					'ticket_type_id'     => $retry_ticket_type_id,
					'seats'              => $retry_seats,
				)
			);
			$event_participant->save();
		}

		// Re-snapshot the selected options against this row id. Idempotent for
		// the reuse path (replaces existing rows) and restorative for the
		// recreate path. Filters out options that no longer exist or are full.
		if ( ! empty( $retry_option_ids ) ) {
			$retry_option_items = $this->load_valid_options( $event_date_id, $retry_option_ids );
			$this->save_participant_options( (int) $event_participant->id, $retry_option_items );
		}

		$new_transaction_id = \FairPayment\API\TransactionAPI::create_transaction(
			$line_items,
			array(
				'currency'      => $old_transaction->currency,
				'description'   => $old_transaction->description,
				'post_id'       => $event_id,
				'event_date_id' => $event_date_id,
				'user_id'       => $user_id ? $user_id : null,
				'metadata'      => array(
					'source'                  => 'fair-audience-signup',
					'event_date_id'           => $event_date_id,
					'event_participant_id'    => (int) $event_participant->id,
					'participant_id'          => $participant_id,
					'ticket_type_id'          => $retry_ticket_type_id,
					'ticket_option_ids'       => $retry_option_ids,
					'retry_of_transaction_id' => $transaction_id,
				),
			)
		);

		if ( is_wp_error( $new_transaction_id ) ) {
			return $new_transaction_id;
		}

		$event_participant->transaction_id = (int) $new_transaction_id;
		$event_participant->save();

		$redirect_url = add_query_arg(
			array(
				'fair_payment_callback' => 'true',
				'fair_signup_tx'        => $new_transaction_id,
				'fst_sig'               => \FairAudience\Services\TransactionAccessToken::generate(
					(int) $new_transaction_id,
					(int) $participant_id
				),
			),
			get_permalink( $event_id )
		);

		$payment = \FairPayment\API\TransactionAPI::initiate_payment(
			$new_transaction_id,
			array(
				'redirect_url' => $redirect_url,
			)
		);

		if ( is_wp_error( $payment ) ) {
			return $payment;
		}

		return rest_ensure_response(
			array(
				'success'        => true,
				'status'         => 'payment_required',
				'message'        => __( 'Redirecting to payment…', 'fair-audience' ),
				'checkout_url'   => $payment['checkout_url'],
				'transaction_id' => (int) $new_transaction_id,
				'amount'         => $old_transaction->amount,
				'currency'       => $old_transaction->currency,
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
		$event_id         = $request->get_param( 'event_id' );
		$name             = $request->get_param( 'name' );
		$surname          = $request->get_param( 'surname' );
		$email            = $request->get_param( 'email' );
		$keep_informed    = $request->get_param( 'keep_informed' );
		$ticket_type_id   = $request->get_param( 'ticket_type_id' ) ?: null;
		$invitation_token = $request->get_param( 'invitation_token' ) ?: '';
		$raw_option_ids   = $request->get_param( 'ticket_option_ids' ) ?: array();

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Resolve event_date_id.
		$event_date_id = $request->get_param( 'event_date_id' ) ?: 0;
		if ( empty( $event_date_id ) && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_dates_obj = \FairEvents\Models\EventDates::get_by_event_id( $event_id );
			if ( $event_dates_obj ) {
				$event_date_id = (int) $event_dates_obj->id;
			}
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

		// Logged-in WP users with a linked participant get to skip the email
		// lookup entirely. Their wp_user_id is a stronger identity than the
		// typed email — typing someone else's email shouldn't let them sign
		// up under that participant. Rate limit is also bypassed because
		// they've already authenticated.
		$wp_user_id         = get_current_user_id();
		$participant        = null;
		$existing           = null;
		$is_new_participant = false;

		if ( $wp_user_id ) {
			$participant = $this->participant_repository->get_by_user_id( $wp_user_id );
		}

		if ( ! $participant ) {
			// Check rate limit only when going through the email-lookup flow.
			if ( $this->is_rate_limited( $email ) ) {
				return new WP_Error(
					'rate_limited',
					__( 'Too many requests. Please try again later.', 'fair-audience' ),
					array( 'status' => 429 )
				);
			}
			$this->increment_rate_limit( $email );

			$participant = $this->participant_repository->get_by_email( $email );

			// Known email + anonymous flow: if the browser doesn't already
			// hold a session for *this* participant, don't act on their
			// identity. A stranger guessing the email shouldn't sign someone
			// up or trigger any pre-fill — send a resume link to the address
			// instead so only the inbox owner can continue.
			if ( $participant ) {
				$session_pid = (int) AudienceSession::get_participant_id();
				if ( $session_pid !== (int) $participant->id ) {
					$token_url = ParticipantToken::get_url(
						$participant->id,
						(int) $event_date_id,
						(int) $event->ID
					);
					$this->email_service->send_signup_link_email( $event, $participant, $token_url );

					return rest_ensure_response(
						array(
							'success' => true,
							'status'  => 'email_recognized',
							'message' => __( 'We recognise this email — check your inbox to continue.', 'fair-audience' ),
						)
					);
				}
			}
		}

		if ( $participant ) {
			// Participant exists - check if already signed up.
			if ( $event_date_id ) {
				$existing = $this->event_participant_repository->get_by_event_date_and_participant(
					$event_date_id,
					$participant->id
				);
			} else {
				$existing = $this->event_participant_repository->get_by_event_and_participant(
					$event_id,
					$participant->id
				);
			}

			if ( $existing && 'signed_up' === $existing->label ) {
				return rest_ensure_response(
					array(
						'success' => true,
						'message' => __( 'You are already signed up for this event.', 'fair-audience' ),
						'status'  => 'already_signed_up',
					)
				);
			}
		} else {
			// Create new participant before starting the paid or free flow so
			// we always have a participant_id to link the signup/payment to.
			$participant = new Participant();
			$participant->populate(
				array(
					'name'          => $name,
					'surname'       => $surname,
					'email'         => $email,
					'email_profile' => $keep_informed ? 'marketing' : 'minimal',
					'status'        => $keep_informed ? 'pending' : 'confirmed',
				)
			);

			if ( ! $participant->save() ) {
				return new WP_Error(
					'creation_failed',
					__( 'Failed to process registration. Please try again.', 'fair-audience' ),
					array( 'status' => 500 )
				);
			}

			$is_new_participant = true;
		}

		// Validate ticket type group restrictions (and invitation tokens for invitation-only types).
		$group_error = $this->validate_ticket_type_group_restriction( $ticket_type_id, $participant->id, $invitation_token );
		if ( is_wp_error( $group_error ) ) {
			return $group_error;
		}

		// Reject sold-out tiers server-side too — the frontend disables them
		// but a stale page or crafted request could still POST a full
		// ticket_type_id.
		$capacity_error = $this->validate_ticket_type_capacity( $ticket_type_id );
		if ( is_wp_error( $capacity_error ) ) {
			return $capacity_error;
		}

		// Paid path takes over when a positive price resolves for this participant.
		$option_items = $this->load_valid_options( $event_date_id, $raw_option_ids );

		$min_error = $this->validate_minimum_activities( $event_date_id, $option_items );
		if ( is_wp_error( $min_error ) ) {
			return $min_error;
		}

		$paid_response = $this->maybe_start_paid_signup( $event_id, $event_date_id, $participant, $existing, $wp_user_id, $ticket_type_id, $option_items, $invitation_token );
		if ( null !== $paid_response ) {
			if ( $is_new_participant && ! is_wp_error( $paid_response ) ) {
				AudienceSession::set( (int) $participant->id );
			}
			return $paid_response;
		}

		// Free path: sign the participant up.
		if ( $existing ) {
			if ( $event_date_id ) {
				$this->event_participant_repository->update_label_by_event_date( $event_date_id, $participant->id, 'signed_up' );
			} else {
				$this->event_participant_repository->update_label( $event_id, $participant->id, 'signed_up' );
			}
		} else {
			$this->event_participant_repository->add_participant_to_event( $event_id, $participant->id, 'signed_up', $event_date_id );
		}

		$this->snapshot_ticket_type_on_signup( $event_date_id, $participant->id, $ticket_type_id );
		$this->snapshot_options_on_signup( $event_date_id, $participant->id, $option_items );

		$option_names = array_map( fn( $o ) => $o->name, $option_items );
		$this->email_service->send_signup_payment_confirmation( $participant, $event, null, $option_names );

		if ( $is_new_participant ) {
			AudienceSession::set( (int) $participant->id );
		}

		// If keep_informed, send confirmation email.
		if ( $keep_informed ) {
			$token = $this->token_repository->create_token( $participant->id );
			if ( $token ) {
				$this->email_service->send_confirmation_email( $participant, $token->token );
			}

			return rest_ensure_response(
				array(
					'success' => true,
					'message' => __( 'You have been signed up for the event! Please check your email to confirm your subscription.', 'fair-audience' ),
					'status'  => 'registered_and_signed_up',
				)
			);
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'You have successfully registered and signed up for the event!', 'fair-audience' ),
				'status'  => 'registered_and_signed_up',
			)
		);
	}

	/**
	 * Cancel signup for event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function cancel_signup( $request ) {
		$event_id          = $request->get_param( 'event_id' );
		$participant_token = $request->get_param( 'participant_token' );
		$user_id           = get_current_user_id();

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Resolve event_date_id.
		$event_date_id = $request->get_param( 'event_date_id' ) ?: 0;
		if ( empty( $event_date_id ) && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_dates_obj = \FairEvents\Models\EventDates::get_by_event_id( $event_id );
			if ( $event_dates_obj ) {
				$event_date_id = (int) $event_dates_obj->id;
			}
		}

		// Get participant based on auth method.
		$participant = null;

		if ( ! empty( $participant_token ) ) {
			$token_data = ParticipantToken::verify( $participant_token );
			if ( $token_data ) {
				$participant = $this->participant_repository->get_by_id( $token_data['participant_id'] );
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

		// Check if signed up.
		if ( $event_date_id ) {
			$existing = $this->event_participant_repository->get_by_event_date_and_participant(
				$event_date_id,
				$participant->id
			);
		} else {
			$existing = $this->event_participant_repository->get_by_event_and_participant(
				$event_id,
				$participant->id
			);
		}

		if ( ! $existing || 'signed_up' !== $existing->label ) {
			return new WP_Error(
				'not_signed_up',
				__( 'You are not signed up for this event.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Remove signup.
		if ( $event_date_id ) {
			$this->event_participant_repository->remove_participant_from_event_date( $event_date_id, $participant->id );
		} else {
			$this->event_participant_repository->remove_participant_from_event( $event_id, $participant->id );
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'You have been removed from this event.', 'fair-audience' ),
				'status'  => 'cancelled',
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
