<?php
/**
 * Event Signup REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\EventParticipantTransactionRepository;
use FairAudience\Services\AudienceSession;
use FairAudience\Services\EmailService;
use FairAudience\Services\GroupSignupPricing;
use FairAudience\Services\ParticipantToken;
use FairAudience\Services\TicketActivities;
use FairAudience\Services\SignupActivities;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;
use FairEventsShared\Money;

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
	 * Constructor.
	 */
	public function __construct() {
		$this->participant_repository       = new ParticipantRepository();
		$this->event_participant_repository = new EventParticipantRepository();
		$this->email_service                = new EmailService();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/event-signup/resume.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/resume',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_resume_payload' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'participant_token' => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'resume'            => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/event-signup.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_signup' ),
					'permission_callback' => array( $this, 'create_signup_permissions_check' ),
					'args'                => array(
						'event_id'              => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'event_date_id'         => array(
							'type'              => 'integer',
							'required'          => false,
							'sanitize_callback' => 'absint',
						),
						'ticket_type_id'        => array(
							'type'              => 'integer',
							'required'          => false,
							'sanitize_callback' => 'absint',
						),
						'ticket_option_ids'     => array(
							'type'  => 'array',
							'items' => array( 'type' => 'integer' ),
						),
						'chosen_amount'         => array(
							'type'     => 'number',
							'required' => false,
						),
						// Chosen occurrence IDs for 'multiple_instances' ticket types.
						// Capped so a crafted request can't force an unbounded number
						// of line items / DB rows per submission.
						'event_date_ids'        => array(
							'type'              => 'array',
							'items'             => array( 'type' => 'integer' ),
							'required'          => false,
							'validate_callback' => function ( $value ) {
								return ! is_array( $value ) || count( $value ) <= 50;
							},
						),
						'participant_token'     => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
						),
						// No 'type' declared: a JSON string sent via FormData would
						// otherwise be mangled. The QuestionnaireService parse/sanitize
						// helpers handle both raw JSON strings and decoded arrays.
						'questionnaire_answers' => array(
							'required' => false,
							'default'  => array(),
						),
					),
				),
			)
		);

		// DELETE /fair-audience/v1/event-signup.
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

		// POST /fair-audience/v1/event-signup/retry-payment.
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

		// POST /fair-audience/v1/event-signup/add-activities.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/add-activities',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'add_activities' ),
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
						'ticket_option_ids' => array(
							'type'     => 'array',
							'required' => true,
							'items'    => array( 'type' => 'integer' ),
						),
						'ticket_id'         => array(
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
	 * Fetch a stashed signup submission for a resume link.
	 *
	 * Only unlocked by presenting both a valid participant_token (HMAC-signed,
	 * proves the caller received the emailed link) and the resume token it
	 * was paired with. Single-use: the transient is deleted as soon as it is
	 * successfully read, matching the "resume link works once" guarantee.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_resume_payload( $request ) {
		$participant_token = $request->get_param( 'participant_token' );
		$resume_token      = $request->get_param( 'resume' );

		$token_data = ParticipantToken::verify( $participant_token );
		if ( ! $token_data ) {
			return new WP_Error(
				'invalid_token',
				__( 'This link is invalid or has expired.', 'fair-audience' ),
				array( 'status' => 403 )
			);
		}

		$payload = \FairAudience\Services\PendingSignupStash::consume( $resume_token, (int) $token_data['participant_id'] );
		if ( ! $payload ) {
			return new WP_Error(
				'resume_not_found',
				__( 'This registration link has expired. Please fill in the form again.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		unset( $payload['participant_id'] );

		return rest_ensure_response(
			array(
				'success' => true,
				'payload' => $payload,
			)
		);
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
		$ticket_type_id    = $request->get_param( 'ticket_type_id' ) ? $request->get_param( 'ticket_type_id' ) : null;
		$user_id           = get_current_user_id();
		$raw_option_ids    = $request->get_param( 'ticket_option_ids' ) ? $request->get_param( 'ticket_option_ids' ) : array();
		$chosen_amount     = $request->get_param( 'chosen_amount' );

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
		$event_date_id = (int) $request->get_param( 'event_date_id' );
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

		// 'multiple_instances' ticket types pick several specific occurrences
		// instead of retargeting to the master (whole_series) or staying on one
		// occurrence (single_instance) — handled by a dedicated path that
		// creates one signup row per chosen occurrence.
		if ( $ticket_type_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$tt_for_multi = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
			if ( $tt_for_multi && $tt_for_multi->is_multiple_instances() ) {
				return $this->create_multi_instance_signup( $request, $event, $event_id, $participant, $tt_for_multi );
			}
		}

		// For whole-series ticket types, retarget event_date_id to the master so one
		// row covers every occurrence in the series. Single-instance path is unchanged.
		if ( $ticket_type_id && $event_date_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$tt_for_scope = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
			if ( $tt_for_scope && $tt_for_scope->is_whole_series() && class_exists( \FairEvents\Models\EventDates::class ) ) {
				$ed_for_scope = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
				if ( $ed_for_scope && 'generated' === $ed_for_scope->occurrence_type && $ed_for_scope->master_id ) {
					$event_date_id = (int) $ed_for_scope->master_id;
				}
			}
		}

		// Parse and validate custom question answers before any mutation.
		$questionnaire_answers = $this->prepare_questionnaire_answers( $request );
		if ( is_wp_error( $questionnaire_answers ) ) {
			return $questionnaire_answers;
		}

		// Validate ticket type group restrictions.
		$group_error = $this->validate_ticket_type_group_restriction( $ticket_type_id, $participant->id );
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

		// Reject disabled/expired ticket types server-side.
		$availability_error = $this->validate_ticket_type_enabled( $ticket_type_id );
		if ( is_wp_error( $availability_error ) ) {
			return $availability_error;
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
			// A whole-series purchase over an existing single-instance signup is
			// an upgrade, not a duplicate: proceed (charging only the difference)
			// instead of short-circuiting. Returns null when this is not an
			// upgrade case, so a genuine repeat still reports already_signed_up.
			$upgrade_response = $this->maybe_start_series_upgrade_payment( $event_id, $event_date_id, $participant, $existing, $ticket_type_id );
			if ( null !== $upgrade_response ) {
				if ( ! is_wp_error( $upgrade_response ) ) {
					AudienceSession::set( (int) $participant->id );
				}
				return $upgrade_response;
			}

			AudienceSession::set( (int) $participant->id );
			return rest_ensure_response(
				array(
					'success' => true,
					'message' => __( 'You are already signed up for this event.', 'fair-audience' ),
					'status'  => 'already_signed_up',
				)
			);
		}

		// The same selection rules fair-events applies on its own signup
		// route: a stale selection is refused rather than silently dropped.
		if ( $event_date_id && class_exists( \FairEvents\Services\ActivitySelection::class ) ) {
			$master_event_date_id = $this->resolve_master_event_date_id( $event_date_id );
			$selection_error      = \FairEvents\Services\ActivitySelection::validate(
				array_values( array_filter( array_unique( array_map( 'absint', (array) $raw_option_ids ) ) ) ),
				$master_event_date_id ? (int) $master_event_date_id : (int) $event_date_id,
				(int) $ticket_type_id,
				(int) $event_date_id
			);
			if ( is_wp_error( $selection_error ) ) {
				return $selection_error;
			}
		}

		$option_items = $this->load_valid_options( $event_date_id, $raw_option_ids );

		// Persist custom question answers up front so they survive the paid
		// flow (the signup row may be only pending_payment at this point).
		$save_error = $this->save_signup_questionnaire( $request, $questionnaire_answers, $participant->id, $event_date_id, $event_id );
		if ( is_wp_error( $save_error ) ) {
			return $save_error;
		}

		$paid_response = $this->maybe_start_paid_signup( $event_id, $event_date_id, $participant, $existing, $user_id, $ticket_type_id, $option_items, $chosen_amount );
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
			$event_participant_id = (int) $existing->id;
		} else {
			$event_participant_id = (int) $this->event_participant_repository->add_participant_to_event( $event_id, $participant->id, 'signed_up', $event_date_id );
		}

		$this->snapshot_ticket_type_on_signup( $event_date_id, $participant->id, $ticket_type_id );
		$this->snapshot_options_on_signup( $event_date_id, $participant->id, $option_items );

		$option_names = $this->translated_option_names( $option_items );
		$this->email_service->send_signup_payment_confirmation( $participant, $event, null, $option_names, (int) $event_date_id, (int) $ticket_type_id, $event_participant_id );

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
	 * Sign up for one or more specific occurrences of a recurring series
	 * ('multiple_instances' ticket types). Unlike single_instance (one
	 * occurrence) and whole_series (retargeted to the master), this creates
	 * one EventParticipant row per chosen occurrence — sharing a single
	 * transaction on the paid path, so PaymentHooks::handle_signup_paid()
	 * confirms them together.
	 *
	 * @param WP_REST_Request                  $request          Request object.
	 * @param WP_Post                          $event            Event post.
	 * @param int                              $event_id         Event post ID.
	 * @param \FairAudience\Models\Participant $participant      Participant doing the signup.
	 * @param \FairEvents\Models\TicketType    $ticket_type      The 'multiple_instances' ticket type.
	 * @return WP_REST_Response|WP_Error
	 */
	private function create_multi_instance_signup( $request, $event, $event_id, $participant, $ticket_type ) {
		$raw_ids = $request->get_param( 'event_date_ids' ) ? $request->get_param( 'event_date_ids' ) : array();
		$raw_ids = array_slice( array_values( array_unique( array_map( 'absint', (array) $raw_ids ) ) ), 0, 50 );
		$raw_ids = array_filter( $raw_ids );

		if ( empty( $raw_ids ) ) {
			return new WP_Error(
				'no_occurrences_selected',
				__( 'Please select at least one occurrence.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		if ( ! class_exists( \FairEvents\Models\EventDates::class ) ) {
			return new WP_Error(
				'invalid_ticket_type',
				__( 'Invalid ticket type.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Validate every submitted ID is a real occurrence belonging to the
		// same series as the ticket type — never trust the client list.
		$series_master_id = $this->resolve_master_event_date_id( (int) $ticket_type->event_date_id );
		if ( ! $series_master_id ) {
			return new WP_Error(
				'invalid_ticket_type',
				__( 'Invalid ticket type.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$occurrences = array();
		foreach ( $raw_ids as $occ_id ) {
			$occ = \FairEvents\Models\EventDates::get_by_id( $occ_id );
			if ( ! $occ || $this->resolve_master_event_date_id( $occ_id ) !== $series_master_id ) {
				return new WP_Error(
					'invalid_occurrence',
					__( 'One of the selected occurrences is not valid for this ticket.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}
			$occurrences[] = $occ;
		}

		$minimum_instances = max( 1, (int) $ticket_type->minimum_instances );
		if ( count( $occurrences ) < $minimum_instances ) {
			return new WP_Error(
				'minimum_instances_not_met',
				sprintf(
					/* translators: %d: minimum number of occurrences required */
					_n(
						'Please select at least %d occurrence.',
						'Please select at least %d occurrences.',
						$minimum_instances,
						'fair-audience'
					),
					$minimum_instances
				),
				array( 'status' => 400 )
			);
		}

		// Drop occurrences the participant already holds a signed-up slot for.
		$pending_occurrences = array();
		foreach ( $occurrences as $occ ) {
			$rel = $this->event_participant_repository->get_by_event_date_and_participant( (int) $occ->id, $participant->id );
			if ( $rel && 'signed_up' === $rel->label ) {
				continue;
			}
			$pending_occurrences[] = $occ;
		}

		if ( empty( $pending_occurrences ) ) {
			AudienceSession::set( (int) $participant->id );
			return rest_ensure_response(
				array(
					'success' => true,
					'message' => __( 'You are already signed up for these occurrences.', 'fair-audience' ),
					'status'  => 'already_signed_up',
				)
			);
		}

		$group_error = $this->validate_ticket_type_group_restriction( $ticket_type->id, $participant->id );
		if ( is_wp_error( $group_error ) ) {
			return $group_error;
		}

		$capacity_error = $this->validate_ticket_type_capacity( $ticket_type->id );
		if ( is_wp_error( $capacity_error ) ) {
			return $capacity_error;
		}

		$availability_error = $this->validate_ticket_type_enabled( $ticket_type->id );
		if ( is_wp_error( $availability_error ) ) {
			return $availability_error;
		}

		// Recompute the per-instance price server-side; never trust a client amount.
		$resolved     = \FairAudience\Services\SignupPriceResolver::resolve_price_for_ticket_type( $ticket_type->id, $participant->id );
		$unit_price   = null !== $resolved ? (float) $resolved : 0.0;
		$count        = count( $pending_occurrences );
		$total_amount = $unit_price * $count;

		if ( $total_amount <= 0 ) {
			foreach ( $pending_occurrences as $occ ) {
				$existing_occ = $this->event_participant_repository->get_by_event_date_and_participant( (int) $occ->id, $participant->id );
				if ( $existing_occ ) {
					$this->event_participant_repository->update_label_by_event_date( (int) $occ->id, $participant->id, 'signed_up' );
				} else {
					$this->event_participant_repository->add_participant_to_event( $event_id, $participant->id, 'signed_up', (int) $occ->id );
				}
				$this->snapshot_ticket_type_on_signup( (int) $occ->id, $participant->id, $ticket_type->id );
			}

			AudienceSession::set( (int) $participant->id );

			return rest_ensure_response(
				array(
					'success' => true,
					'message' => __( 'You have successfully signed up for the event!', 'fair-audience' ),
					'status'  => 'signed_up',
				)
			);
		}

		if ( ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class )
			|| ! \FairPaymentsConnector\API\TransactionAPI::is_configured() ) {
			return new WP_Error(
				'payment_unavailable',
				__( 'Paid signup is not available because the payment plugin is not configured.', 'fair-audience' ),
				array( 'status' => 503 )
			);
		}

		// Per-occurrence capacity check.
		foreach ( $pending_occurrences as $occ ) {
			if ( null === $occ->capacity ) {
				continue;
			}
			$active_count       = $this->event_participant_repository->count_active_for_event_date( (int) $occ->id );
			$existing_occ       = $this->event_participant_repository->get_by_event_date_and_participant( (int) $occ->id, $participant->id );
			$already_holds_slot = $existing_occ && in_array( $existing_occ->label, array( 'signed_up', 'pending_payment' ), true );
			$projected          = $active_count - ( $already_holds_slot ? 1 : 0 ) + 1;
			if ( $projected > (int) $occ->capacity ) {
				return new WP_Error(
					'event_full',
					__( 'One of the selected occurrences is fully booked.', 'fair-audience' ),
					array( 'status' => 409 )
				);
			}
		}

		$expires_at            = gmdate( 'Y-m-d H:i:s', time() + 15 * MINUTE_IN_SECONDS );
		$event_participant_ids = array();
		$line_items            = array();

		foreach ( $pending_occurrences as $occ ) {
			$existing_occ = $this->event_participant_repository->get_by_event_date_and_participant( (int) $occ->id, $participant->id );
			if ( $existing_occ ) {
				$existing_occ->label              = 'pending_payment';
				$existing_occ->payment_expires_at = $expires_at;
				$existing_occ->ticket_type_id     = $ticket_type->id;
				$existing_occ->save();
				$ep = $existing_occ;
			} else {
				$ep = new \FairAudience\Models\EventParticipant(
					array(
						'event_id'           => $event_id,
						'event_date_id'      => (int) $occ->id,
						'participant_id'     => $participant->id,
						'label'              => 'pending_payment',
						'payment_expires_at' => $expires_at,
						'ticket_type_id'     => $ticket_type->id,
					)
				);
				$ep->save();
			}
			$event_participant_ids[] = (int) $ep->id;

			$occ_label    = class_exists( \FairEvents\Helpers\DateRangeFormatter::class )
				? \FairEvents\Helpers\DateRangeFormatter::format( $occ->start_datetime, $occ->end_datetime, (bool) $occ->all_day )
				: $occ->start_datetime;
			$line_items[] = array(
				'name'     => sprintf(
					/* translators: %s: event title or occurrence date/time label */
					__( 'Signup for %s', 'fair-audience' ),
					$occ_label
				),
				'quantity' => 1,
				'amount'   => $unit_price,
			);
		}

		$transaction_id = \FairPaymentsConnector\API\TransactionAPI::create_transaction(
			$line_items,
			array(
				'currency'      => Money::site_currency(),
				'description'   => sprintf(
					/* translators: %s: event title or occurrence date/time label */
					__( 'Signup for %s', 'fair-audience' ),
					get_the_title( $event_id )
				),
				'post_id'       => $event_id,
				'event_date_id' => (int) $pending_occurrences[0]->id,
				'user_id'       => get_current_user_id() ? get_current_user_id() : null,
				'metadata'      => array(
					'source'                => 'fair-audience-signup',
					'event_date_id'         => (int) $pending_occurrences[0]->id,
					'event_participant_ids' => $event_participant_ids,
					'participant_id'        => $participant->id,
					'ticket_type_id'        => (int) $ticket_type->id,
				),
			)
		);

		if ( is_wp_error( $transaction_id ) ) {
			return $transaction_id;
		}

		$ledger = new EventParticipantTransactionRepository();
		foreach ( $event_participant_ids as $ep_id ) {
			// One ledger row per occurrence row, all sharing this transaction.
			$ledger->record( $ep_id, (int) $transaction_id, 'charge' );
		}

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

		$payment = \FairPaymentsConnector\API\TransactionAPI::initiate_payment(
			$transaction_id,
			array( 'redirect_url' => $redirect_url )
		);

		if ( is_wp_error( $payment ) ) {
			return $payment;
		}

		AudienceSession::set( (int) $participant->id );

		return rest_ensure_response(
			array(
				'success'        => true,
				'status'         => 'payment_required',
				'message'        => __( 'Redirecting to payment…', 'fair-audience' ),
				'checkout_url'   => esc_url_raw( $payment['checkout_url'] ),
				'transaction_id' => $transaction_id,
				'amount'         => $total_amount,
				'currency'       => Money::site_currency(),
			)
		);
	}

	/**
	 * Add one or more activity options to an existing (already signed-up)
	 * subscription. Free additions attach immediately; priced additions route
	 * the buyer through payment for just the delta and only attach on success
	 * (see PaymentHooks::handle_activities_added_paid).
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function add_activities( $request ) {
		$event_id          = $request->get_param( 'event_id' );
		$participant_token = $request->get_param( 'participant_token' );
		$user_id           = get_current_user_id();
		$raw_option_ids    = $request->get_param( 'ticket_option_ids' ) ? $request->get_param( 'ticket_option_ids' ) : array();

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
		$event_date_id = (int) $request->get_param( 'event_date_id' );
		if ( empty( $event_date_id ) && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_dates_obj = \FairEvents\Models\EventDates::get_by_event_id( $event_id );
			if ( $event_dates_obj ) {
				$event_date_id = (int) $event_dates_obj->id;
			}
		}

		// Resolve participant from token or logged-in user.
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

		// The subscription must already exist and be signed up — adding
		// activities to a non-existent or pending signup is out of scope.
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
				__( 'You need an active signup before you can add activities.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Added activities belong to one of the participant's tickets on this
		// date; without tickets they stay on the relationship.
		$ticket = TicketActivities::resolve_addon_target( (int) $existing->event_date_id, (int) $participant->id, (int) $request->get_param( 'ticket_id' ) );
		if ( is_wp_error( $ticket ) ) {
			return $ticket;
		}

		// Validate the requested options (exist for the event date, have capacity).
		$requested = $this->load_valid_options( $event_date_id, $raw_option_ids, $ticket ? (int) $ticket->event_date_id : (int) $existing->event_date_id );

		// Drop options the target already holds — the duplicate-add guard.
		$already_ids = $ticket
			? \FairEvents\Models\EventTicketActivity::get_option_ids( (int) $ticket->id )
			: $this->get_participant_scope_option_ids( (int) $existing->id );
		$new_options = array_values(
			array_filter(
				$requested,
				static function ( $opt ) use ( $already_ids ) {
					return ! in_array( (int) $opt->id, $already_ids, true );
				}
			)
		);

		if ( empty( $new_options ) ) {
			return new WP_Error(
				'no_new_activities',
				__( 'No new activities to add.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$paid_response = $this->maybe_start_addon_payment( $event_id, $event_date_id, $participant, $existing, $user_id, $new_options, $ticket );
		if ( null !== $paid_response ) {
			if ( ! is_wp_error( $paid_response ) ) {
				AudienceSession::set( (int) $participant->id );
			}
			return $paid_response;
		}

		// Free path: attach immediately, checking the activities' places
		// under the capacity lock, and notify.
		$attached = $this->reserve_addon_places(
			$existing,
			$ticket,
			$new_options,
			function () use ( $ticket, $existing, $new_options ) {
				if ( $ticket ) {
					return \FairEvents\Models\EventTicketActivity::confirm( (int) $ticket->id, $new_options );
				}
				$this->save_participant_options( (int) $existing->id, $new_options );
				return true;
			}
		);
		if ( is_wp_error( $attached ) ) {
			return $attached;
		}

		$new_option_ids = array_map( static fn( $opt ) => (int) $opt->id, $new_options );
		do_action( 'fair_audience_event_activities_added', $existing, null, $new_option_ids );

		AudienceSession::set( (int) $participant->id );

		return rest_ensure_response(
			array(
				'success' => true,
				'status'  => 'activities_added',
				'message' => __( 'Your activities have been added!', 'fair-audience' ),
			)
		);
	}

	/**
	 * Start the paid flow for added activities when the new options carry a
	 * positive total. Returns null for the free path so the caller can attach
	 * immediately.
	 *
	 * Unlike maybe_start_paid_signup, this never mutates the existing
	 * (signed_up) row: the subscription stays valid regardless of whether the
	 * add-on payment succeeds. The selected option IDs ride along on the
	 * transaction metadata; PaymentHooks attaches them only once Mollie
	 * confirms the payment.
	 *
	 * @param int                                   $event_id          Event post ID.
	 * @param int                                   $event_date_id     Event date ID.
	 * @param \FairAudience\Models\Participant      $participant       Participant adding activities.
	 * @param \FairAudience\Models\EventParticipant $event_participant Existing signed-up row.
	 * @param int                                   $user_id           Current WP user ID (0 for anonymous).
	 * @param array                                 $new_options       New TicketOption objects to add.
	 * @param object|null                           $ticket            Ticket the activities go to, or null for participant scope.
	 * @return \WP_REST_Response|\WP_Error|null Response/error on paid path, null on free path.
	 */
	private function maybe_start_addon_payment( $event_id, $event_date_id, $participant, $event_participant, $user_id, $new_options, $ticket = null ) {
		$option_prices = $this->resolve_option_prices( $new_options, $event_date_id, (int) $participant->id );
		if ( is_wp_error( $option_prices ) ) {
			return $option_prices;
		}

		$line_items   = array();
		$total_amount = 0;
		foreach ( $new_options as $opt ) {
			$opt_price     = $option_prices[ (int) $opt->id ];
			$total_amount += $opt_price;
			if ( 0.0 !== (float) $opt_price ) {
				$line_items[] = array(
					'name'     => $opt->name,
					'quantity' => 1,
					'amount'   => $opt_price,
				);
			}
		}

		// Any option with a raw price > 0 means payment is configured for that option.
		$any_option_paid = array_reduce(
			$new_options,
			static fn( $carry, $opt ) => $carry || (float) $opt->price > 0,
			false
		);

		if ( $total_amount <= 0 ) {
			// Guard: if any option carries a paid price the connector must be ready,
			// even when a discount reduced the resolved total to zero.
			if ( $any_option_paid ) {
				if ( ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class )
					|| ! \FairPaymentsConnector\API\TransactionAPI::is_configured() ) {
					return new WP_Error(
						'payment_unavailable',
						__( 'Paid activities are not available because the payment plugin is not configured.', 'fair-audience' ),
						array( 'status' => 503 )
					);
				}
			}
			return null;
		}

		if ( ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class )
			|| ! \FairPaymentsConnector\API\TransactionAPI::is_configured() ) {
			return new WP_Error(
				'payment_unavailable',
				__( 'Paid activities are not available because the payment plugin is not configured.', 'fair-audience' ),
				array( 'status' => 503 )
			);
		}

		$description = sprintf(
			/* translators: %s: event title */
			__( 'Added activities for %s', 'fair-audience' ),
			get_the_title( $event_id )
		);

		$new_option_ids = array_map( static fn( $opt ) => (int) $opt->id, $new_options );

		// Hold the activities' places while payment is in flight — the parent
		// row stays signed_up throughout, so only the activity rows carry the
		// pending hold. The places are checked and held under the capacity
		// lock before the payment exists; the provider is called only after
		// the lock is released.
		$addon_expires_at = gmdate( 'Y-m-d H:i:s', time() + 15 * MINUTE_IN_SECONDS );
		$held             = $this->reserve_addon_places(
			$event_participant,
			$ticket,
			$new_options,
			function () use ( $event_participant, $ticket, $new_options, $addon_expires_at ) {
				$this->hold_addon_options( (int) $event_participant->id, $ticket ? (int) $ticket->id : 0, $new_options, $addon_expires_at );
				return true;
			}
		);
		if ( is_wp_error( $held ) ) {
			return $held;
		}

		$transaction_id = \FairPaymentsConnector\API\TransactionAPI::create_transaction(
			$line_items,
			array(
				'currency'      => Money::site_currency(),
				'description'   => $description,
				'post_id'       => $event_id,
				'event_date_id' => $event_date_id,
				'user_id'       => $user_id ? $user_id : null,
				'metadata'      => array(
					'source'               => 'fair-audience-activity-addon',
					'event_date_id'        => $event_date_id,
					'event_participant_id' => (int) $event_participant->id,
					'participant_id'       => (int) $participant->id,
					'ticket_option_ids'    => $new_option_ids,
					'ticket_id'            => $ticket ? (int) $ticket->id : null,
				),
			)
		);

		if ( is_wp_error( $transaction_id ) ) {
			$this->release_addon_holds( (int) $event_participant->id, $ticket ? (int) $ticket->id : 0, $new_option_ids );
			return $transaction_id;
		}

		// Also closes a secondary gap: add-on charges never recorded to the
		// ledger, so payment history for the registration was missing them.
		( new EventParticipantTransactionRepository() )->record( (int) $event_participant->id, (int) $transaction_id, 'charge' );

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

		$payment = \FairPaymentsConnector\API\TransactionAPI::initiate_payment(
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
				'currency'       => Money::site_currency(),
			)
		);
	}

	/**
	 * Validate that a participant is allowed to use a group-restricted ticket
	 * type. Delegates to the shared GroupSignupPricing service — the same
	 * membership-consulting authority the unified-block render overlay uses
	 * — instead of a separately hand-rolled lookup (issue #1299).
	 *
	 * @param int|null $ticket_type_id   Ticket type ID, or null if none selected.
	 * @param int      $participant_id   Participant ID.
	 * @return WP_Error|null WP_Error if restricted, null if allowed.
	 */
	private function validate_ticket_type_group_restriction( $ticket_type_id, $participant_id ) {
		return GroupSignupPricing::restriction_error( $ticket_type_id, $participant_id );
	}

	/**
	 * Resolve the master event-date ID for a given event-date.
	 *
	 * Returns the master_id if the event-date is a generated occurrence, the
	 * event-date's own id if it is the master, or null for non-recurring dates
	 * or when EventDates is unavailable.
	 *
	 * @param int $event_date_id Event-date ID (master or generated occurrence).
	 * @return int|null Master event-date ID, or null.
	 */
	private function resolve_master_event_date_id( $event_date_id ) {
		if ( ! $event_date_id || ! class_exists( \FairEvents\Models\EventDates::class ) ) {
			return null;
		}
		$ed = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $ed ) {
			return null;
		}
		if ( 'generated' === $ed->occurrence_type && $ed->master_id ) {
			return (int) $ed->master_id;
		}
		if ( 'master' === $ed->occurrence_type ) {
			return (int) $ed->id;
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

		$reserved = $this->event_participant_repository->count_signups_for_ticket_type( (int) $ticket_type_id );
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
	 * Reject purchases of ticket types that are manually disabled or whose
	 * scheduled end date has passed, using the WordPress site timezone via
	 * TicketAvailabilityResolver — the same decision the signup form's
	 * display filtering makes, so a stale page or crafted request can never
	 * purchase a type the form itself would no longer show (issue #1581).
	 * Previously checked only the scheduled disable_at boundary (and against
	 * PHP server time, not site time); manual disabling now rejects too.
	 *
	 * @param int|null $ticket_type_id Ticket type ID.
	 * @return WP_Error|null WP_Error if disabled/expired, null if valid.
	 */
	private function validate_ticket_type_enabled( $ticket_type_id ) {
		if ( ! $ticket_type_id || ! class_exists( \FairEvents\Models\TicketType::class ) ) {
			return null;
		}

		$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
		if ( ! $ticket_type ) {
			return null;
		}

		if ( ! \FairAudience\Services\TicketAvailabilityResolver::is_ticket_type_enabled( $ticket_type ) ) {
			return new WP_Error(
				'ticket_type_disabled',
				__( 'This ticket type is no longer available. Please pick another option.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		return null;
	}

	/**
	 * Snapshot ticket_type_id onto the EventParticipant row after a
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
			),
			array(
				'event_date_id'  => (int) $event_date_id,
				'participant_id' => (int) $participant_id,
			),
			array( '%d' ),
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
	 * Load and validate ticket options by ID, ensuring they belong to the event date.
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param array $option_ids    Array of option IDs from the request.
	 * @param int   $occurrence_id Occurrence whose activity places are checked; 0 for $event_date_id.
	 * @param bool  $skip_full     Leave out options with no place left.
	 * @return array Array of valid TicketOption objects.
	 */
	private function load_valid_options( $event_date_id, $option_ids, $occurrence_id = 0, $skip_full = true ) {
		if ( empty( $option_ids ) || ! $event_date_id ) {
			return array();
		}
		$occurrence_id = $occurrence_id ? (int) $occurrence_id : (int) $event_date_id;

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
		// A workshop its schedule marks as not bookable is not a choice.
		$not_bookable = method_exists( \FairEvents\Services\EventSchedule::class, 'non_bookable_option_ids' )
			? \FairEvents\Services\EventSchedule::non_bookable_option_ids( $lookup_id )
			: array();
		foreach ( $all_options as $opt ) {
			if ( in_array( (int) $opt->id, $not_bookable, true ) ) {
				continue;
			}
			$available_by_id[ $opt->id ] = $opt;
		}

		foreach ( $option_ids as $id ) {
			$id = absint( $id );
			if ( ! $id || ! isset( $available_by_id[ $id ] ) ) {
				continue;
			}
			$opt = $available_by_id[ $id ];
			if ( $skip_full && null !== $opt->capacity ) {
				$reserved = $this->event_participant_repository->count_signups_for_ticket_option( (int) $opt->id, $occurrence_id );
				if ( $reserved >= (int) $opt->capacity ) {
					continue;
				}
			}
			$valid_options[] = $opt;
		}

		return $valid_options;
	}

	/**
	 * Resolve every selected option's effective price in one bulk call:
	 * fair-events' base price for the current sale period, with the buyer's
	 * best-matching group pricing rule applied to each option's own base
	 * price (issue #1297). The event's discount rules and the buyer's group
	 * membership are each fetched once for the whole selection (issue #1299).
	 * An option without a price right now refuses the purchase — it is
	 * unavailable, never free.
	 *
	 * @param object[] $option_items   Selected TicketOption objects.
	 * @param int      $event_date_id  Event date ID.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return array<int, float>|WP_Error Effective prices (may be 0), keyed by option ID.
	 */
	private function resolve_option_prices( array $option_items, $event_date_id, $participant_id ) {
		$base_price_by_option_id = array();
		foreach ( $option_items as $option ) {
			$resolved = class_exists( \FairEvents\Services\ActivityOptionPriceResolver::class )
				? \FairEvents\Services\ActivityOptionPriceResolver::resolve( $option )
				: null;
			if ( null === $resolved ) {
				return new WP_Error(
					'ticket_option_unavailable',
					sprintf(
						/* translators: %s: activity name */
						__( '"%s" is not currently on sale. Reload the page and choose again.', 'fair-audience' ),
						$option->name
					),
					array( 'status' => 409 )
				);
			}
			$base_price_by_option_id[ (int) $option->id ] = (float) $resolved;
		}

		return SignupActivities::resolve_prices_for_participant( $base_price_by_option_id, $event_date_id, $participant_id );
	}

	/**
	 * Insert rows into fair_audience_event_participant_options.
	 *
	 * @param int   $event_participant_id Event participant record ID.
	 * @param array $option_items         Array of TicketOption objects.
	 * @return void
	 */
	private function save_participant_options( $event_participant_id, $option_items ) {
		$this->event_participant_repository->add_options( $event_participant_id, $option_items );
	}

	/**
	 * Hold add-on activities while their payment is in flight, on the target
	 * ticket or, without one, on the relationship.
	 *
	 * @param int    $event_participant_id Event participant record ID.
	 * @param int    $ticket_id            Target ticket ID, or 0 for participant scope.
	 * @param array  $option_items         TicketOption objects.
	 * @param string $expires_at           UTC hold expiry.
	 * @return void
	 */
	private function hold_addon_options( $event_participant_id, $ticket_id, $option_items, $expires_at ) {
		if ( $ticket_id ) {
			\FairEvents\Models\EventTicketActivity::hold( (int) $ticket_id, $option_items, $expires_at );
			return;
		}

		$this->event_participant_repository->add_pending_options( $event_participant_id, $option_items, $expires_at );
	}

	/**
	 * Option IDs held at participant scope on a relationship, leaving out
	 * history carried over to a ticket.
	 *
	 * @param int  $event_participant_id Event participant record ID.
	 * @param bool $confirmed_only       Leave out holds awaiting payment.
	 * @param bool $active_only          Leave out holds that have expired.
	 * @return int[]
	 */
	private function get_participant_scope_option_ids( $event_participant_id, $confirmed_only = false, $active_only = false ) {
		$now        = gmdate( 'Y-m-d H:i:s' );
		$option_ids = array();
		foreach ( $this->event_participant_repository->get_participant_scope_option_rows( array( (int) $event_participant_id ) ) as $row ) {
			if ( $confirmed_only && 'confirmed' !== $row->status ) {
				continue;
			}
			if ( $active_only && 'confirmed' !== $row->status && ( empty( $row->expires_at ) || (string) $row->expires_at <= $now ) ) {
				continue;
			}
			$option_ids[] = (int) $row->ticket_option_id;
		}

		return $option_ids;
	}

	/**
	 * Check the places added activities need and write them under the
	 * capacity lock fair-events uses for purchases, so concurrent add-ons,
	 * purchases and edits cannot together exceed an activity's limit. The
	 * places are taken on the ticket's occurrence (every occurrence a
	 * whole-series ticket covers), or on the relationship's event date for
	 * participant-level activities.
	 *
	 * @param \FairAudience\Models\EventParticipant $event_participant Relationship.
	 * @param object|null                           $ticket            Target ticket, or null for participant scope.
	 * @param array                                 $options           TicketOption objects that need a place.
	 * @param callable                              $write             Writes the activities; false or WP_Error rolls back.
	 * @return mixed|\WP_Error The write's result, or a 409 error naming the full activity.
	 */
	private function reserve_addon_places( $event_participant, $ticket, array $options, callable $write ) {
		if ( ! class_exists( \FairEvents\Services\TicketCapacity::class )
			|| ! method_exists( \FairEvents\Services\TicketCapacity::class, 'count_ticket_option' )
		) {
			return $write();
		}

		$result = \FairEvents\Services\TicketCapacity::reserve(
			array(
				array(
					'event_date_id'  => $ticket ? (int) $ticket->event_date_id : (int) $event_participant->event_date_id,
					'ticket_type_id' => $ticket ? (int) $ticket->ticket_type_id : (int) $event_participant->ticket_type_id,
					'quantity'       => 0,
					'option_ids'     => array_map( static fn( $opt ) => (int) $opt->id, $options ),
				),
			),
			$write
		);

		if ( false === $result ) {
			return new WP_Error(
				'activities_not_saved',
				__( 'Your activities could not be saved. Please try again.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return $result;
	}

	/**
	 * Release add-on holds placed for a payment that could not be started.
	 *
	 * @param int   $event_participant_id Event participant record ID.
	 * @param int   $ticket_id            Target ticket ID, or 0 for participant scope.
	 * @param int[] $option_ids           Ticket option IDs.
	 * @return void
	 */
	private function release_addon_holds( $event_participant_id, $ticket_id, array $option_ids ) {
		if ( $ticket_id ) {
			\FairEvents\Models\EventTicketActivity::release_holds( (int) $ticket_id, $option_ids );
			return;
		}

		$this->event_participant_repository->release_pending_options( (int) $event_participant_id, $option_ids );
	}

	/**
	 * Resolve option display names for the confirmation email, translated
	 * through Polylang when fair-events-experimental's translation bridge
	 * is available — keeps the emailed list matching whatever language the
	 * buyer saw the option names in on the signup form.
	 *
	 * @param object[] $option_items Selected TicketOption objects.
	 * @return string[] Option names.
	 */
	private function translated_option_names( array $option_items ) {
		return array_map(
			function ( $o ) {
				return class_exists( \FairEvents\Services\ActivityOptionTranslation::class )
					? \FairEvents\Services\ActivityOptionTranslation::translate_name( $o )
					: $o->name;
			},
			$option_items
		);
	}

	/**
	 * Parse and sanitize the custom question answers from a signup request.
	 *
	 * Validation runs before any signup mutation so bad input (e.g. malformed
	 * phone numbers) is rejected with a 400 without creating a participant or
	 * signup row.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return array|WP_Error Sanitized answers, or WP_Error on invalid input.
	 */
	private function prepare_questionnaire_answers( $request ) {
		if ( ! class_exists( '\FairForm\Services\QuestionnaireService' ) ) {
			return array();
		}
		$service = new \FairForm\Services\QuestionnaireService();
		$answers = $service->parse_answers( $request->get_param( 'questionnaire_answers' ) );
		return $service->sanitize_answers( $answers );
	}

	/**
	 * Process uploads for and persist the custom question answers tied to a
	 * signup. Answers are stored as a questionnaire submission keyed by
	 * participant + event date (title "Event Signup"), so they survive the
	 * paid-signup flow and surface in the admin signups list and Form Answers
	 * view. The save is idempotent per participant + event date.
	 *
	 * @param WP_REST_Request $request        Request object.
	 * @param array           $answers        Sanitized answers.
	 * @param int             $participant_id Participant ID.
	 * @param int             $event_date_id  Event date ID.
	 * @param int             $event_id       Event post ID.
	 * @return void|WP_Error WP_Error on file-upload failure.
	 */
	private function save_signup_questionnaire( $request, $answers, $participant_id, $event_date_id, $event_id ) {
		// Nothing to persist for signups without custom questions — avoids
		// creating empty submissions (and any regression for plain signups).
		if ( empty( $answers ) ) {
			return;
		}

		if ( ! class_exists( '\FairForm\Services\QuestionnaireService' ) ) {
			return;
		}

		$service = new \FairForm\Services\QuestionnaireService();
		$answers = $service->process_file_uploads( $request, $answers, $event_date_id, $participant_id );
		if ( is_wp_error( $answers ) ) {
			return $answers;
		}

		$service->save_answers(
			$participant_id,
			$answers,
			$event_date_id,
			$event_id,
			__( 'Event Signup', 'fair-audience' ),
			true
		);
	}

	/**
	 * Start the paid-signup flow when the event date has a positive resolved
	 * price for this participant. Returns null for the free path so the caller
	 * can continue with its normal success response.
	 *
	 * On paid: upserts a `pending_payment` participant row holding a 15-minute
	 * slot, creates a fair-payments-connector transaction linked back to that row via
	 * metadata + transaction_id, and returns the Mollie checkout URL.
	 *
	 * @param int                                        $event_id       Event post ID.
	 * @param int                                        $event_date_id  Event date ID.
	 * @param \FairAudience\Models\Participant           $participant    Participant doing the signup.
	 * @param \FairAudience\Models\EventParticipant|null $existing       Existing row for (event_date, participant), if any.
	 * @param int                                        $user_id        Current WP user ID (0 for anonymous).
	 * @param int|null                                   $ticket_type_id Selected ticket type ID, or null when not using ticket types.
	 * @param array                                      $option_items     Selected TicketOption objects.
	 * @param float|null                                 $chosen_amount    Unused; kept for call-site compatibility.
	 * @return \WP_REST_Response|\WP_Error|null WP_REST_Response/WP_Error on paid path, null on free path.
	 */
	private function maybe_start_paid_signup( $event_id, $event_date_id, $participant, $existing, $user_id, $ticket_type_id = null, $option_items = array(), $chosen_amount = null ) {
		$final_price = null;
		if ( $event_date_id && $ticket_type_id ) {
			$final_price = \FairAudience\Services\SignupPriceResolver::resolve_price_for_ticket_type( $ticket_type_id, $participant->id );
		}

		// Option prices count towards the total even when there is no base price.
		// Each option resolves its own best-matching group discount rule
		// against its own real base price (issue #1297), resolved once for the
		// whole selection here and reused below when building line items,
		// instead of recomputing per option twice over (issue #1299). Summed
		// per raw selected item (not per unique option ID) so a duplicate
		// option ID counts twice here exactly as it does in the line items
		// built below — array_sum() over the ID-keyed map would silently
		// collapse a duplicate and undercount the total against what's
		// actually charged.
		$option_prices = $this->resolve_option_prices( $option_items, $event_date_id, (int) $participant->id );
		if ( is_wp_error( $option_prices ) ) {
			return $option_prices;
		}
		$options_total = 0.0;
		foreach ( $option_items as $opt ) {
			$options_total += $option_prices[ (int) $opt->id ];
		}
		$total_amount = (float) ( $final_price ?? 0 ) + $options_total;

		// Determine whether a price is configured for this event regardless of
		// how the resolution turned out (discount-to-zero, service unavailable, etc.).
		$has_paid_price_configured = $event_date_id
			&& \FairAudience\Services\SignupPriceResolver::has_paid_price_configured(
				(int) $event_date_id,
				$ticket_type_id
			);

		if ( $total_amount <= 0 ) {
			// A paid event must never slip through as free when the connector isn't ready.
			if ( $has_paid_price_configured ) {
				if ( ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class )
					|| ! \FairPaymentsConnector\API\TransactionAPI::is_configured() ) {
					return new WP_Error(
						'payment_unavailable',
						__( 'Paid signup is not available because the payment plugin is not configured.', 'fair-audience' ),
						array( 'status' => 503 )
					);
				}
			}
			return null;
		}

		if ( ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class )
			|| ! \FairPaymentsConnector\API\TransactionAPI::is_configured() ) {
			return new WP_Error(
				'payment_unavailable',
				__( 'Paid signup is not available because the payment plugin is not configured.', 'fair-audience' ),
				array( 'status' => 503 )
			);
		}

		$event_date_row = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( $event_date_row && null !== $event_date_row->capacity ) {
			$active_count       = $this->event_participant_repository->count_active_for_event_date( $event_date_id );
			$already_holds_slot = $existing && in_array( $existing->label, array( 'signed_up', 'pending_payment' ), true );
			$projected          = $active_count - ( $already_holds_slot ? 1 : 0 ) + 1;
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
			$existing->ticket_type_id     = $ticket_type_id ? $ticket_type_id : null;
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
					'ticket_type_id'     => $ticket_type_id ? $ticket_type_id : null,
				)
			);
			$event_participant->save();
		}

		$this->save_participant_options( (int) $event_participant->id, $option_items );

		$line_item_description = sprintf(
			/* translators: %s: event title or occurrence date/time label */
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
			$opt_price = $option_prices[ (int) $opt->id ];
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

		$transaction_id = \FairPaymentsConnector\API\TransactionAPI::create_transaction(
			$line_items,
			array(
				'currency'      => Money::site_currency(),
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

		// Record the ledger link at creation time, not just on webhook
		// confirmation — a later attempt on this registration must not orphan
		// this charge (see #1112).
		( new EventParticipantTransactionRepository() )->record( (int) $event_participant->id, (int) $transaction_id, 'charge' );

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

		$payment = \FairPaymentsConnector\API\TransactionAPI::initiate_payment(
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
				'currency'       => Money::site_currency(),
			)
		);
	}

	/**
	 * Upgrade an existing single-instance signup to a whole-series pass.
	 *
	 * Called from create_signup() when the buyer already holds a signed_up row
	 * on the (retargeted) master date and the selected ticket type is
	 * whole-series. The seat and prior payment stay put: like
	 * maybe_start_addon_payment, this never mutates the existing row on the paid
	 * path — an abandoned upgrade leaves the original single-instance signup
	 * intact. On payment success PaymentHooks::handle_series_upgrade_paid()
	 * flips the row's ticket_type to the series pass.
	 *
	 * The buyer is charged only the difference between the series price and what
	 * they have already paid on this registration (per the transaction ledger).
	 *
	 * @param int                              $event_id       Event post ID.
	 * @param int                              $event_date_id  Event date ID (already retargeted to the master).
	 * @param \FairAudience\Models\Participant $participant    Participant doing the upgrade.
	 * @param object                           $existing       Existing signed_up EventParticipant row.
	 * @param int|null                         $ticket_type_id Selected whole-series ticket type ID.
	 * @return \WP_REST_Response|\WP_Error|null Response/error for the upgrade path, null when not an upgrade.
	 */
	private function maybe_start_series_upgrade_payment( $event_id, $event_date_id, $participant, $existing, $ticket_type_id ) {
		if ( ! $ticket_type_id || ! class_exists( \FairEvents\Models\TicketType::class ) ) {
			return null;
		}

		$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
		if ( ! $ticket_type || ! $ticket_type->is_whole_series() ) {
			return null;
		}

		// A row that already carries a whole-series ticket type is a genuine
		// repeat purchase — fall back to the already_signed_up response.
		if ( $existing->ticket_type_id ) {
			$existing_tt = \FairEvents\Models\TicketType::get_by_id( (int) $existing->ticket_type_id );
			if ( $existing_tt && $existing_tt->is_whole_series() ) {
				return null;
			}
		}

		$resolved     = \FairAudience\Services\SignupPriceResolver::resolve_price_for_ticket_type( $ticket_type->id, $participant->id );
		$series_price = null !== $resolved ? (float) $resolved : 0.0;

		$ledger   = new EventParticipantTransactionRepository();
		$net_paid = $ledger->get_net_paid( (int) $existing->id );
		$delta    = max( 0.0, $series_price - $net_paid );

		// Nothing left to pay (already covered, or a free series): convert in place now.
		if ( $delta <= 0 ) {
			$existing->ticket_type_id = (int) $ticket_type->id;
			$existing->save();

			return rest_ensure_response(
				array(
					'success' => true,
					'status'  => 'signed_up',
					'message' => __( 'Your series pass is now active!', 'fair-audience' ),
				)
			);
		}

		if ( ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class )
			|| ! \FairPaymentsConnector\API\TransactionAPI::is_configured() ) {
			return new WP_Error(
				'payment_unavailable',
				__( 'Paid signup is not available because the payment plugin is not configured.', 'fair-audience' ),
				array( 'status' => 503 )
			);
		}

		$line_items = array(
			array(
				'name'     => sprintf(
					/* translators: %s: ticket type name */
					__( 'Upgrade to series pass: %s', 'fair-audience' ),
					$ticket_type->name
				),
				'quantity' => 1,
				'amount'   => $delta,
			),
		);

		$transaction_id = \FairPaymentsConnector\API\TransactionAPI::create_transaction(
			$line_items,
			array(
				'currency'      => Money::site_currency(),
				'description'   => sprintf(
					/* translators: %s: event title */
					__( 'Series pass upgrade for %s', 'fair-audience' ),
					get_the_title( $event_id )
				),
				'post_id'       => $event_id,
				'event_date_id' => $event_date_id,
				'user_id'       => get_current_user_id() ? get_current_user_id() : null,
				'metadata'      => array(
					'source'               => 'fair-audience-series-upgrade',
					'event_date_id'        => $event_date_id,
					'event_participant_id' => (int) $existing->id,
					'participant_id'       => (int) $participant->id,
					'ticket_type_id'       => (int) $ticket_type->id,
				),
			)
		);

		if ( is_wp_error( $transaction_id ) ) {
			return $transaction_id;
		}

		$ledger->record( (int) $existing->id, (int) $transaction_id, 'charge' );

		// Deliberately do NOT touch $existing here: the seat and original payment
		// remain valid whether or not the upgrade payment completes.

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

		$payment = \FairPaymentsConnector\API\TransactionAPI::initiate_payment(
			$transaction_id,
			array( 'redirect_url' => $redirect_url )
		);

		if ( is_wp_error( $payment ) ) {
			return $payment;
		}

		return rest_ensure_response(
			array(
				'success'        => true,
				'status'         => 'payment_required',
				'message'        => __( 'Redirecting to payment…', 'fair-audience' ),
				'checkout_url'   => esc_url_raw( $payment['checkout_url'] ),
				'transaction_id' => $transaction_id,
				'amount'         => $delta,
				'currency'       => Money::site_currency(),
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

		if ( ! class_exists( \FairPaymentsConnector\API\TransactionAPI::class ) ) {
			return new WP_Error(
				'payment_unavailable',
				__( 'Payment plugin is missing.', 'fair-audience' ),
				array( 'status' => 503 )
			);
		}

		$transaction = \FairPaymentsConnector\API\TransactionAPI::get_transaction( $transaction_id );
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
	 * fair-payments-connector transaction is always created since fair-payments-connector refuses
	 * to re-initiate a transaction once a Mollie payment has been attached.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function retry_payment( $request ) {
		$transaction_id = (int) $request->get_param( 'transaction_id' );

		$old_transaction = \FairPaymentsConnector\API\TransactionAPI::get_transaction( $transaction_id );
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
		$source   = $metadata['source'] ?? '';

		// Added-activities add-ons retry along a separate path: the base signup
		// row must not be touched, so they don't go through the row-mutation
		// logic below.
		if ( 'fair-audience-activity-addon' === $source ) {
			return $this->retry_addon_payment( $old_transaction, $metadata );
		}

		if ( 'fair-audience-signup' !== $source ) {
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

		// Look up the EventParticipant row by (event_date_id, participant_id),
		// the natural key, rather than by transaction_id: the row may already
		// have been re-pointed to a newer retry transaction.
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
		$old_line_items = \FairPaymentsConnector\Models\LineItem::get_by_transaction_id( $transaction_id );
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

		// Refresh / acquire the 15-minute hold for this retry attempt.
		$expires_at = gmdate( 'Y-m-d H:i:s', time() + 15 * MINUTE_IN_SECONDS );

		if ( $event_participant ) {
			$event_participant->label              = 'pending_payment';
			$event_participant->payment_expires_at = $expires_at;
			$event_participant->ticket_type_id     = $retry_ticket_type_id;
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

		$new_transaction_id = \FairPaymentsConnector\API\TransactionAPI::create_transaction(
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

		// Record the ledger link at creation time: this retry accumulates a
		// new charge alongside the prior attempt's, so the ledger is the only
		// place that remembers each attempt (see #1112).
		( new EventParticipantTransactionRepository() )->record( (int) $event_participant->id, (int) $new_transaction_id, 'charge' );

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

		$payment = \FairPaymentsConnector\API\TransactionAPI::initiate_payment(
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
	 * Retry a failed added-activities (add-on) payment. Mirrors the original
	 * line items into a fresh transaction without touching the still-valid
	 * signed_up row. The activities only attach once Mollie confirms (see
	 * PaymentHooks::handle_activities_added_paid), so a previously failed
	 * attempt left nothing attached.
	 *
	 * @param object $old_transaction The failed/expired add-on transaction.
	 * @param array  $metadata        Decoded metadata from the old transaction.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	private function retry_addon_payment( $old_transaction, $metadata ) {
		$transaction_id       = (int) $old_transaction->id;
		$event_id             = isset( $metadata['post_id'] ) ? (int) $metadata['post_id'] : (int) $old_transaction->post_id;
		$event_date_id        = isset( $metadata['event_date_id'] ) ? (int) $metadata['event_date_id'] : (int) $old_transaction->event_date_id;
		$participant_id       = isset( $metadata['participant_id'] ) ? (int) $metadata['participant_id'] : (int) $old_transaction->participant_id;
		$event_participant_id = isset( $metadata['event_participant_id'] ) ? (int) $metadata['event_participant_id'] : 0;
		$option_ids           = isset( $metadata['ticket_option_ids'] ) && is_array( $metadata['ticket_option_ids'] )
			? array_map( 'intval', $metadata['ticket_option_ids'] )
			: array();
		$user_id              = isset( $old_transaction->user_id ) ? (int) $old_transaction->user_id : 0;

		if ( ! $event_id || ! $participant_id || ! $event_participant_id || empty( $option_ids ) ) {
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

		$event_participant = $this->event_participant_repository->get_by_id( $event_participant_id );
		if ( ! $event_participant || 'signed_up' !== $event_participant->label ) {
			return new WP_Error(
				'not_signed_up',
				__( 'Your signup is no longer active.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		// The retry targets the same ticket as the attempt it replaces. A
		// ticket no longer confirmed cannot receive the activities any more.
		$ticket_id = isset( $metadata['ticket_id'] ) ? (int) $metadata['ticket_id'] : 0;
		if ( $ticket_id ) {
			$ticket = TicketActivities::resolve_addon_target( (int) $event_participant->event_date_id, $participant_id, $ticket_id );
			if ( ! $ticket || is_wp_error( $ticket ) ) {
				return new WP_Error(
					'not_signed_up',
					__( 'Your ticket is no longer active.', 'fair-audience' ),
					array( 'status' => 409 )
				);
			}
		}

		// Already confirmed (e.g. the original payment landed after all)?
		// Nothing to retry. Deliberately confirmed-only: the option's own
		// still-pending hold from the attempt being retried is expected to be
		// present here and must not look like it's already attached.
		$already_ids   = $ticket_id
			? \FairEvents\Models\EventTicketActivity::get_option_ids( $ticket_id, true )
			: $this->get_participant_scope_option_ids( $event_participant_id, true );
		$remaining_ids = array_values( array_diff( $option_ids, $already_ids ) );
		if ( empty( $remaining_ids ) ) {
			return rest_ensure_response(
				array(
					'success' => true,
					'status'  => 'activities_added',
					'message' => __( 'These activities are already on your signup.', 'fair-audience' ),
				)
			);
		}

		// Rebuild line items from the original transaction so the retry charges
		// exactly what the buyer agreed to.
		$old_line_items = \FairPaymentsConnector\Models\LineItem::get_by_transaction_id( $transaction_id );
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

		// Refresh the pending reservation for this retry attempt so the hold
		// survives — mirrors the base retry path renewing its hold. A hold
		// that already lapsed released its places, which someone else may
		// have taken since: they are taken back only if still available.
		$remaining_options = $this->load_valid_options( $event_date_id, $remaining_ids, 0, false );
		$still_held_ids    = $ticket_id
			? \FairEvents\Models\EventTicketActivity::get_active_option_ids( array( $ticket_id ) )
			: $this->get_participant_scope_option_ids( $event_participant_id, false, true );
		$addon_expires_at  = gmdate( 'Y-m-d H:i:s', time() + 15 * MINUTE_IN_SECONDS );
		$held              = $this->reserve_addon_places(
			$event_participant,
			$ticket_id ? \FairEvents\Models\EventTicket::get_by_id( $ticket_id ) : null,
			array_values(
				array_filter(
					$remaining_options,
					static fn( $opt ) => ! in_array( (int) $opt->id, $still_held_ids, true )
				)
			),
			function () use ( $event_participant_id, $ticket_id, $remaining_options, $addon_expires_at ) {
				$this->hold_addon_options( $event_participant_id, $ticket_id, $remaining_options, $addon_expires_at );
				return true;
			}
		);
		if ( is_wp_error( $held ) ) {
			return $held;
		}

		$new_transaction_id = \FairPaymentsConnector\API\TransactionAPI::create_transaction(
			$line_items,
			array(
				'currency'      => $old_transaction->currency,
				'description'   => $old_transaction->description,
				'post_id'       => $event_id,
				'event_date_id' => $event_date_id,
				'user_id'       => $user_id ? $user_id : null,
				'metadata'      => array(
					'source'                  => 'fair-audience-activity-addon',
					'event_date_id'           => $event_date_id,
					'event_participant_id'    => $event_participant_id,
					'participant_id'          => $participant_id,
					'ticket_option_ids'       => $option_ids,
					'ticket_id'               => $ticket_id ? $ticket_id : null,
					'retry_of_transaction_id' => $transaction_id,
				),
			)
		);

		if ( is_wp_error( $new_transaction_id ) ) {
			return $new_transaction_id;
		}

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

		$payment = \FairPaymentsConnector\API\TransactionAPI::initiate_payment(
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
		$event_date_id = (int) $request->get_param( 'event_date_id' );
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

		if ( ! $existing || ! in_array( $existing->label, array( 'signed_up', 'pending_payment' ), true ) ) {
			return new WP_Error(
				'not_signed_up',
				__( 'You are not signed up for this event.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// A relationship backed by tickets is one admission for possibly
		// several purchases. Removing it would invalidate every ticket the
		// participant holds or bought there, so only a relationship without
		// tickets (an older or hand-added admission) is cancelled this way.
		if ( $event_date_id && TicketActivities::backs_admission( $event_date_id, (int) $participant->id ) ) {
			return new WP_Error(
				'signup_has_tickets',
				__( 'This signup has tickets and cannot be cancelled here. Please contact the organizer.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		// Remove signup (also clears a pending_payment hold row, so a stale
		// checkout is not offered again — issue #554).
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
}
