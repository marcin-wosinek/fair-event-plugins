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
						'participant_token' => array(
							'type'              => 'string',
							'required'          => false,
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
						'event_id'       => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'event_date_id'  => array(
							'type'              => 'integer',
							'required'          => false,
							'sanitize_callback' => 'absint',
						),
						'ticket_type_id' => array(
							'type'              => 'integer',
							'required'          => false,
							'sanitize_callback' => 'absint',
						),
						'name'           => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'surname'        => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'email'          => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_email',
							'validate_callback' => function ( $value ) {
								return is_email( $value );
							},
						),
						'keep_informed'  => array(
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
			return rest_ensure_response(
				array(
					'success' => true,
					'message' => __( 'You are already signed up for this event.', 'fair-audience' ),
					'status'  => 'already_signed_up',
				)
			);
		}

		$paid_response = $this->maybe_start_paid_signup( $event_id, $event_date_id, $participant, $existing, $user_id, $ticket_type_id );
		if ( null !== $paid_response ) {
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

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'You have successfully signed up for the event!', 'fair-audience' ),
				'status'  => 'signed_up',
			)
		);
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

		$row = $this->event_participant_repository->get_by_event_date_and_participant( $event_date_id, $participant_id );
		if ( ! $row ) {
			return;
		}

		$row->ticket_type_id = (int) $ticket_type_id;
		$row->seats          = max( 1, (int) $ticket_type->seats_per_ticket );
		$row->save();
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
	 * @return \WP_REST_Response|\WP_Error|null WP_REST_Response/WP_Error on paid path, null on free path.
	 */
	private function maybe_start_paid_signup( $event_id, $event_date_id, $participant, $existing, $user_id, $ticket_type_id = null ) {
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

		if ( null === $final_price || $final_price <= 0 ) {
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

		$line_item_description = sprintf(
			/* translators: %s: event title */
			__( 'Signup for %s', 'fair-audience' ),
			get_the_title( $event_id )
		);

		$transaction_id = \FairPayment\API\TransactionAPI::create_transaction(
			array(
				array(
					'name'     => $line_item_description,
					'quantity' => 1,
					'amount'   => (float) $final_price,
				),
			),
			array(
				'currency'    => 'EUR',
				'description' => $line_item_description,
				'post_id'     => $event_id,
				'user_id'     => $user_id ? $user_id : null,
				'metadata'    => array(
					'source'               => 'fair-audience-signup',
					'event_date_id'        => $event_date_id,
					'event_participant_id' => $event_participant->id,
					'participant_id'       => $participant->id,
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
				'amount'         => (float) $final_price,
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
	 * Register new participant and sign up for event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function register_and_signup( $request ) {
		$event_id       = $request->get_param( 'event_id' );
		$name           = $request->get_param( 'name' );
		$surname        = $request->get_param( 'surname' );
		$email          = $request->get_param( 'email' );
		$keep_informed  = $request->get_param( 'keep_informed' );
		$ticket_type_id = $request->get_param( 'ticket_type_id' ) ?: null;

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
		$existing    = null;

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
		}

		// Paid path takes over when a positive price resolves for this participant.
		$paid_response = $this->maybe_start_paid_signup( $event_id, $event_date_id, $participant, $existing, 0, $ticket_type_id );
		if ( null !== $paid_response ) {
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
