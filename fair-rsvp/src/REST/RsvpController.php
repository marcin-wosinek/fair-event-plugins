<?php
/**
 * REST API controller for RSVPs
 *
 * @package FairRsvp
 */

namespace FairRsvp\REST;

use FairRsvp\Database\RsvpRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * RSVP REST API controller
 */
class RsvpController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-rsvp/v1';

	/**
	 * RSVP repository instance
	 *
	 * @var RsvpRepository
	 */
	private $repository;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->repository = new RsvpRepository();
	}

	/**
	 * Register the routes for RSVPs
	 *
	 * @return void
	 */
	public function register_routes() {
		// POST /fair-rsvp/v1/rsvp - User creates/updates RSVP.
		register_rest_route(
			$this->namespace,
			'/rsvp',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_or_update_rsvp' ),
					'permission_callback' => array( $this, 'create_rsvp_permissions_check' ),
					'args'                => $this->get_rsvp_create_schema(),
				),
			)
		);

		// GET /fair-rsvp/v1/rsvp?event_id={id} - User gets their RSVP.
		register_rest_route(
			$this->namespace,
			'/rsvp',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_user_rsvp' ),
					'permission_callback' => array( $this, 'get_user_rsvp_permissions_check' ),
					'args'                => array(
						'event_id' => array(
							'description' => __( 'Event ID to get RSVP for.', 'fair-rsvp' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);

		// PATCH /fair-rsvp/v1/rsvps/{id}/attendance - Admin updates attendance.
		register_rest_route(
			$this->namespace,
			'/rsvps/(?P<id>[\d]+)/attendance',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_attendance' ),
					'permission_callback' => array( $this, 'update_attendance_permissions_check' ),
					'args'                => array(
						'id'                => array(
							'description' => __( 'RSVP ID.', 'fair-rsvp' ),
							'type'        => 'integer',
							'required'    => true,
						),
						'attendance_status' => array(
							'description' => __( 'Attendance status.', 'fair-rsvp' ),
							'type'        => 'string',
							'required'    => true,
							'enum'        => array( 'not_applicable', 'checked_in', 'no_show' ),
						),
					),
				),
			)
		);

		// GET /fair-rsvp/v1/rsvps?event_id={id} - Admin gets all RSVPs.
		register_rest_route(
			$this->namespace,
			'/rsvps',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_rsvps' ),
					'permission_callback' => array( $this, 'get_rsvps_permissions_check' ),
					'args'                => $this->get_rsvps_collection_params(),
				),
			)
		);

		// GET /fair-rsvp/v1/events - Admin gets all events with RSVP counts.
		register_rest_route(
			$this->namespace,
			'/events',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_events' ),
					'permission_callback' => array( $this, 'get_events_permissions_check' ),
					'args'                => array(
						'status'  => array(
							'description' => __( 'Post status filter.', 'fair-rsvp' ),
							'type'        => 'string',
							'default'     => 'publish',
						),
						'orderby' => array(
							'description' => __( 'Order by field.', 'fair-rsvp' ),
							'type'        => 'string',
							'default'     => 'title',
							'enum'        => array( 'title', 'total_rsvps', 'yes_count' ),
						),
						'order'   => array(
							'description' => __( 'Order direction.', 'fair-rsvp' ),
							'type'        => 'string',
							'default'     => 'asc',
							'enum'        => array( 'asc', 'desc' ),
						),
					),
				),
			)
		);

		// GET /fair-rsvp/v1/participants?event_id={id} - Public endpoint for participant list.
		register_rest_route(
			$this->namespace,
			'/participants',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_participants' ),
					'permission_callback' => '__return_true', // Open to all.
					'args'                => array(
						'event_id' => array(
							'description' => __( 'Event ID to get participants for.', 'fair-rsvp' ),
							'type'        => 'integer',
							'required'    => true,
						),
						'status'   => array(
							'description' => __( 'RSVP status to filter by.', 'fair-rsvp' ),
							'type'        => 'string',
							'default'     => 'yes',
							'enum'        => array( 'yes', 'maybe', 'no' ),
						),
					),
				),
			)
		);

		// GET /fair-rsvp/v1/users - Admin gets all users for selection.
		register_rest_route(
			$this->namespace,
			'/users',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_users' ),
					'permission_callback' => array( $this, 'update_attendance_permissions_check' ),
				),
			)
		);

		// POST /fair-rsvp/v1/rsvps/bulk-attendance - Admin bulk updates attendance.
		register_rest_route(
			$this->namespace,
			'/rsvps/bulk-attendance',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'bulk_update_attendance' ),
					'permission_callback' => array( $this, 'update_attendance_permissions_check' ),
					'args'                => array(
						'updates' => array(
							'description' => __( 'Array of RSVP updates with id and attendance_status.', 'fair-rsvp' ),
							'type'        => 'array',
							'required'    => true,
							'items'       => array(
								'type'       => 'object',
								'properties' => array(
									'id'                => array(
										'type' => 'integer',
									),
									'attendance_status' => array(
										'type' => 'string',
										'enum' => array( 'not_applicable', 'checked_in', 'no_show' ),
									),
								),
							),
						),
					),
				),
			)
		);

		// POST /fair-rsvp/v1/rsvps/walk-in - Admin creates RSVP for walk-in attendee.
		register_rest_route(
			$this->namespace,
			'/rsvps/walk-in',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_walk_in_rsvp' ),
					'permission_callback' => array( $this, 'update_attendance_permissions_check' ),
					'args'                => array(
						'event_id' => array(
							'description' => __( 'Event ID.', 'fair-rsvp' ),
							'type'        => 'integer',
							'required'    => true,
						),
						'name'     => array(
							'description' => __( 'Attendee name.', 'fair-rsvp' ),
							'type'        => 'string',
							'required'    => true,
						),
						'email'    => array(
							'description' => __( 'Attendee email (optional).', 'fair-rsvp' ),
							'type'        => 'string',
							'format'      => 'email',
						),
					),
				),
			)
		);

		// GET /fair-rsvp/v1/attendance-check?event_id={id} - Get attendance check data.
		register_rest_route(
			$this->namespace,
			'/attendance-check',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_attendance_check' ),
					'permission_callback' => array( $this, 'get_attendance_check_permissions_check' ),
					'args'                => array(
						'event_id' => array(
							'description' => __( 'Event ID to get attendance check for.', 'fair-rsvp' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Create or update RSVP
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function create_or_update_rsvp( $request ) {
		$event_id    = (int) $request->get_param( 'event_id' );
		$rsvp_status = sanitize_text_field( $request->get_param( 'rsvp_status' ) );
		$name        = $request->get_param( 'name' );
		$email       = $request->get_param( 'email' );

		// Validate event exists and is published.
		$event = get_post( $event_id );
		if ( ! $event || 'publish' !== $event->post_status ) {
			return new WP_Error(
				'invalid_event',
				__( 'The specified event does not exist or is not published.', 'fair-rsvp' ),
				array( 'status' => 400 )
			);
		}

		// Determine user_id.
		$user_id = get_current_user_id();

		// If name and email are provided, this is an anonymous RSVP - create or get user.
		if ( ! empty( $name ) && ! empty( $email ) ) {
			$user_id = $this->get_or_create_user_from_anonymous_rsvp( $name, $email );

			if ( is_wp_error( $user_id ) ) {
				return $user_id;
			}
		}

		// At this point we must have a user_id (either from login or from anonymous user creation).
		if ( ! $user_id ) {
			return new WP_Error(
				'no_user',
				__( 'Unable to determine user for RSVP.', 'fair-rsvp' ),
				array( 'status' => 500 )
			);
		}

		// Upsert RSVP.
		$rsvp_id = $this->repository->upsert_rsvp( $event_id, $user_id, $rsvp_status );

		if ( ! $rsvp_id ) {
			return new WP_Error(
				'rsvp_creation_failed',
				__( 'Failed to create or update RSVP.', 'fair-rsvp' ),
				array( 'status' => 500 )
			);
		}

		// Get the created/updated RSVP.
		$rsvp = $this->repository->get_rsvp_by_id( $rsvp_id );

		if ( ! $rsvp ) {
			return new WP_Error(
				'rsvp_retrieval_failed',
				__( 'RSVP was created but could not be retrieved.', 'fair-rsvp' ),
				array( 'status' => 500 )
			);
		}

		$response = $this->prepare_item_for_response( $rsvp, $request );
		$response->set_status( 201 );

		return $response;
	}

	/**
	 * Get or create user from anonymous RSVP
	 *
	 * @param string $name User's name.
	 * @param string $email User's email.
	 * @return int|WP_Error User ID on success, WP_Error on failure.
	 */
	private function get_or_create_user_from_anonymous_rsvp( $name, $email ) {
		// Sanitize inputs.
		$name  = sanitize_text_field( $name );
		$email = sanitize_email( $email );

		// Check if user with this email already exists.
		$existing_user = get_user_by( 'email', $email );
		if ( $existing_user ) {
			return $existing_user->ID;
		}

		// Generate username from email.
		$username = sanitize_user( $email, true );

		// If username exists, append number until we find a unique one.
		if ( username_exists( $username ) ) {
			$counter = 1;
			while ( username_exists( $username . $counter ) ) {
				++$counter;
			}
			$username = $username . $counter;
		}

		// Generate random password.
		$password = wp_generate_password( 24, true, true );

		// Create user.
		$user_id = wp_create_user( $username, $password, $email );

		if ( is_wp_error( $user_id ) ) {
			return new WP_Error(
				'user_creation_failed',
				__( 'Failed to create user account.', 'fair-rsvp' ),
				array( 'status' => 500 )
			);
		}

		// Update user display name.
		wp_update_user(
			array(
				'ID'           => $user_id,
				'display_name' => $name,
				'role'         => 'subscriber',
			)
		);

		// Send welcome email with password reset link.
		$this->send_welcome_email( $user_id, $email );

		return $user_id;
	}

	/**
	 * Send welcome email to newly created user
	 *
	 * @param int    $user_id User ID.
	 * @param string $email User's email address.
	 * @return void
	 */
	private function send_welcome_email( $user_id, $email ) {
		// Generate password reset link.
		$reset_key = get_password_reset_key( get_userdata( $user_id ) );

		if ( is_wp_error( $reset_key ) ) {
			// If we can't generate reset key, just return - don't fail the RSVP.
			return;
		}

		$reset_url = network_site_url( "wp-login.php?action=rp&key=$reset_key&login=" . rawurlencode( get_userdata( $user_id )->user_login ), 'login' );

		// Prepare email.
		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
		/* translators: %s: Site name */
		$subject = sprintf( __( 'Welcome to %s', 'fair-rsvp' ), $site_name );

		/* translators: 1: User display name, 2: Site name, 3: Password reset URL */
		$message = sprintf(
			__(
				'Hi %1$s,

Thank you for your RSVP! An account has been created for you on %2$s.

To set your password and access your account, please visit:
%3$s

If you did not make this RSVP, you can safely ignore this email.

Best regards,
The %2$s Team',
				'fair-rsvp'
			),
			get_userdata( $user_id )->display_name,
			$site_name,
			$reset_url
		);

		// Send email.
		wp_mail( $email, $subject, $message );
	}

	/**
	 * Get user's RSVP for an event
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function get_user_rsvp( $request ) {
		$event_id = (int) $request->get_param( 'event_id' );
		$user_id  = get_current_user_id();

		$rsvp = $this->repository->get_rsvp_by_event_and_user( $event_id, $user_id );

		if ( ! $rsvp ) {
			return new WP_Error(
				'rsvp_not_found',
				__( 'RSVP not found for this event.', 'fair-rsvp' ),
				array( 'status' => 404 )
			);
		}

		return $this->prepare_item_for_response( $rsvp, $request );
	}

	/**
	 * Update attendance status
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function update_attendance( $request ) {
		$id                = (int) $request->get_param( 'id' );
		$attendance_status = sanitize_text_field( $request->get_param( 'attendance_status' ) );

		// Check RSVP exists.
		$rsvp = $this->repository->get_rsvp_by_id( $id );
		if ( ! $rsvp ) {
			return new WP_Error(
				'rsvp_not_found',
				__( 'RSVP not found.', 'fair-rsvp' ),
				array( 'status' => 404 )
			);
		}

		// Update attendance status.
		$result = $this->repository->update_attendance_status( $id, $attendance_status );

		if ( ! $result ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update attendance status.', 'fair-rsvp' ),
				array( 'status' => 500 )
			);
		}

		// Get updated RSVP.
		$rsvp = $this->repository->get_rsvp_by_id( $id );

		return $this->prepare_item_for_response( $rsvp, $request );
	}

	/**
	 * Get RSVPs for an event
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_rsvps( $request ) {
		$event_id          = (int) $request->get_param( 'event_id' );
		$rsvp_status       = $request->get_param( 'rsvp_status' );
		$attendance_status = $request->get_param( 'attendance_status' );
		$limit             = (int) $request->get_param( 'per_page' );
		$offset            = ( (int) $request->get_param( 'page' ) - 1 ) * $limit;

		$rsvps = $this->repository->get_rsvps_by_event(
			$event_id,
			$rsvp_status,
			$attendance_status,
			$limit,
			$offset
		);

		$data = array();
		foreach ( $rsvps as $rsvp ) {
			$data[] = $this->prepare_item_for_response( $rsvp, $request );
		}

		return rest_ensure_response( $data );
	}

	/**
	 * Get all events with RSVP counts
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_events( $request ) {
		$post_status = sanitize_text_field( $request->get_param( 'status' ) );
		$orderby     = sanitize_text_field( $request->get_param( 'orderby' ) );
		$order       = sanitize_text_field( $request->get_param( 'order' ) );

		$events = $this->repository->get_events_with_rsvp_counts( $post_status, $orderby, $order );

		return rest_ensure_response( $events );
	}

	/**
	 * Get participants for an event (public endpoint)
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_participants( $request ) {
		$event_id    = (int) $request->get_param( 'event_id' );
		$rsvp_status = sanitize_text_field( $request->get_param( 'status' ) );

		$participants = $this->repository->get_participants_with_user_data( $event_id, $rsvp_status );
		$count        = count( $participants );

		// Return different data based on login status.
		if ( is_user_logged_in() ) {
			// Logged-in users get full participant list.
			return rest_ensure_response(
				array(
					'count'        => $count,
					'participants' => $participants,
				)
			);
		} else {
			// Anonymous users only get count.
			return rest_ensure_response(
				array(
					'count'        => $count,
					'participants' => null,
				)
			);
		}
	}

	/**
	 * Get all users for selection
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_users( $request ) {
		$users = $this->repository->get_all_users_for_selection();
		return rest_ensure_response( $users );
	}

	/**
	 * Bulk update attendance status
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function bulk_update_attendance( $request ) {
		$updates = $request->get_param( 'updates' );

		if ( empty( $updates ) || ! is_array( $updates ) ) {
			return new WP_Error(
				'invalid_updates',
				__( 'Updates must be a non-empty array.', 'fair-rsvp' ),
				array( 'status' => 400 )
			);
		}

		$result = $this->repository->bulk_update_attendance( $updates );

		return rest_ensure_response(
			array(
				'success' => $result['success'],
				'failed'  => $result['failed'],
				'message' => sprintf(
					/* translators: %d: number of successful updates */
					__( 'Successfully updated %d attendance records.', 'fair-rsvp' ),
					$result['success']
				),
			)
		);
	}

	/**
	 * Create RSVP for walk-in attendee
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function create_walk_in_rsvp( $request ) {
		$event_id = (int) $request->get_param( 'event_id' );
		$name     = sanitize_text_field( $request->get_param( 'name' ) );
		$email    = sanitize_email( $request->get_param( 'email' ) );

		// Validate event exists and is published.
		$event = get_post( $event_id );
		if ( ! $event || 'publish' !== $event->post_status ) {
			return new WP_Error(
				'invalid_event',
				__( 'The specified event does not exist or is not published.', 'fair-rsvp' ),
				array( 'status' => 400 )
			);
		}

		// Get or create user for walk-in.
		$user_id = $this->repository->get_or_create_walk_in_user( $name, $email );

		if ( ! $user_id ) {
			return new WP_Error(
				'user_creation_failed',
				__( 'Failed to create or find user for walk-in attendee.', 'fair-rsvp' ),
				array( 'status' => 500 )
			);
		}

		// Create RSVP with 'yes' status and 'checked_in' attendance.
		$rsvp_id = $this->repository->upsert_rsvp( $event_id, $user_id, 'yes' );

		if ( ! $rsvp_id ) {
			return new WP_Error(
				'rsvp_creation_failed',
				__( 'Failed to create RSVP for walk-in attendee.', 'fair-rsvp' ),
				array( 'status' => 500 )
			);
		}

		// Update attendance status to checked_in.
		$this->repository->update_attendance_status( $rsvp_id, 'checked_in' );

		// Get the created RSVP.
		$rsvp = $this->repository->get_rsvp_by_id( $rsvp_id );

		if ( ! $rsvp ) {
			return new WP_Error(
				'rsvp_retrieval_failed',
				__( 'RSVP was created but could not be retrieved.', 'fair-rsvp' ),
				array( 'status' => 500 )
			);
		}

		$response = $this->prepare_item_for_response( $rsvp, $request );
		$response->set_status( 201 );

		return $response;
	}

	/**
	 * Check permissions for creating RSVPs
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if the request has access, WP_Error object otherwise.
	 */
	public function create_rsvp_permissions_check( $request ) {
		$is_logged_in = is_user_logged_in();
		$user_id      = get_current_user_id();

		// Get event and check attendance permissions.
		$event_id = $request->get_param( 'event_id' );
		$event    = get_post( $event_id );

		if ( ! $event ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-rsvp' ),
				array( 'status' => 404 )
			);
		}

		// Find RSVP block in event content.
		$blocks     = parse_blocks( $event->post_content );
		$rsvp_block = $this->find_rsvp_block( $blocks );

		$attendance = array();
		if ( $rsvp_block && isset( $rsvp_block['attrs']['attendance'] ) ) {
			$attendance = $rsvp_block['attrs']['attendance'];
		}

		// Check if anonymous users are allowed.
		$anonymous_permission = isset( $attendance['anonymous'] ) ? (int) $attendance['anonymous'] : 0;
		$allow_anonymous      = $anonymous_permission >= 1;

		// If not logged in, check if anonymous RSVP is allowed.
		if ( ! $is_logged_in ) {
			if ( ! $allow_anonymous ) {
				return new WP_Error(
					'rest_forbidden',
					__( 'You must be logged in to RSVP.', 'fair-rsvp' ),
					array( 'status' => 401 )
				);
			}

			// For anonymous users, require name and email.
			$name  = $request->get_param( 'name' );
			$email = $request->get_param( 'email' );

			if ( empty( $name ) || empty( $email ) ) {
				return new WP_Error(
					'missing_anonymous_fields',
					__( 'Name and email are required for anonymous RSVP.', 'fair-rsvp' ),
					array( 'status' => 400 )
				);
			}

			// Validate email format.
			if ( ! is_email( $email ) ) {
				return new WP_Error(
					'invalid_email',
					__( 'Please provide a valid email address.', 'fair-rsvp' ),
					array( 'status' => 400 )
				);
			}

			// Anonymous users are allowed if they provided name and email.
			return true;
		}

		// For logged-in users, check user permission using AttendanceHelper.
		$permission = \FairRsvp\Utils\AttendanceHelper::get_user_permission(
			$user_id,
			true,
			$attendance
		);

		if ( ! \FairRsvp\Utils\AttendanceHelper::is_allowed( $permission ) ) {
			return new WP_Error(
				'not_allowed',
				__( 'You are not allowed to RSVP to this event.', 'fair-rsvp' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Check permissions for getting user RSVP
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if the request has access, WP_Error object otherwise.
	 */
	public function get_user_rsvp_permissions_check( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in to view RSVPs.', 'fair-rsvp' ),
				array( 'status' => 401 )
			);
		}
		return true;
	}

	/**
	 * Check permissions for updating attendance
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if the request has access, WP_Error object otherwise.
	 */
	public function update_attendance_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for getting all RSVPs
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if the request has access, WP_Error object otherwise.
	 */
	public function get_rsvps_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for getting events
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if the request has access, WP_Error object otherwise.
	 */
	public function get_events_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Format datetime for REST API response with timezone
	 *
	 * @param string|null $datetime MySQL datetime string.
	 * @return string|null ISO 8601 datetime with timezone.
	 */
	private function format_datetime_for_response( $datetime ) {
		if ( empty( $datetime ) ) {
			return null;
		}

		// Convert to timestamp using WordPress timezone.
		$timestamp = strtotime( $datetime );
		if ( false === $timestamp ) {
			return null;
		}

		// Format as ISO 8601 with timezone offset (e.g., "2025-01-30T14:30:00+01:00").
		return wp_date( 'c', $timestamp );
	}

	/**
	 * Prepare RSVP for response
	 *
	 * @param array           $rsvp    RSVP data.
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function prepare_item_for_response( $rsvp, $request ) {
		$data = array(
			'id'                => (int) $rsvp['id'],
			'event_id'          => (int) $rsvp['event_id'],
			'user_id'           => (int) $rsvp['user_id'],
			'rsvp_status'       => $rsvp['rsvp_status'],
			'attendance_status' => $rsvp['attendance_status'],
			'rsvp_at'           => $this->format_datetime_for_response( $rsvp['rsvp_at'] ),
			'created_at'        => $this->format_datetime_for_response( $rsvp['created_at'] ),
			'updated_at'        => $this->format_datetime_for_response( $rsvp['updated_at'] ),
		);

		// Add user data if user exists and request is from admin.
		if ( $rsvp['user_id'] && current_user_can( 'manage_options' ) ) {
			$user = get_userdata( $rsvp['user_id'] );
			if ( $user ) {
				$data['user'] = array(
					'display_name' => $user->display_name,
					'user_email'   => $user->user_email,
					'avatar_url'   => get_avatar_url( $user->ID, array( 'size' => 48 ) ),
				);
			}
		}

		return rest_ensure_response( $data );
	}

	/**
	 * Get RSVP creation schema
	 *
	 * @return array Schema array.
	 */
	public function get_rsvp_create_schema() {
		return array(
			'event_id'    => array(
				'description' => __( 'Event/post ID to RSVP for.', 'fair-rsvp' ),
				'type'        => 'integer',
				'required'    => true,
			),
			'rsvp_status' => array(
				'description' => __( 'RSVP status.', 'fair-rsvp' ),
				'type'        => 'string',
				'required'    => true,
				'enum'        => array( 'yes', 'maybe', 'no', 'cancelled' ),
			),
			'name'        => array(
				'description' => __( 'Name for anonymous RSVP (optional, required if not logged in).', 'fair-rsvp' ),
				'type'        => 'string',
			),
			'email'       => array(
				'description' => __( 'Email for anonymous RSVP (optional, required if not logged in).', 'fair-rsvp' ),
				'type'        => 'string',
				'format'      => 'email',
			),
		);
	}

	/**
	 * Get RSVPs collection parameters
	 *
	 * @return array Collection parameters.
	 */
	public function get_rsvps_collection_params() {
		return array(
			'event_id'          => array(
				'description' => __( 'Event ID to get RSVPs for.', 'fair-rsvp' ),
				'type'        => 'integer',
				'required'    => true,
			),
			'rsvp_status'       => array(
				'description' => __( 'Filter by RSVP status.', 'fair-rsvp' ),
				'type'        => 'string',
				'enum'        => array( 'yes', 'maybe', 'no', 'pending', 'cancelled' ),
			),
			'attendance_status' => array(
				'description' => __( 'Filter by attendance status.', 'fair-rsvp' ),
				'type'        => 'string',
				'enum'        => array( 'not_applicable', 'checked_in', 'no_show' ),
			),
			'page'              => array(
				'description' => __( 'Current page of the collection.', 'fair-rsvp' ),
				'type'        => 'integer',
				'default'     => 1,
				'minimum'     => 1,
			),
			'per_page'          => array(
				'description' => __( 'Maximum number of items to return per page.', 'fair-rsvp' ),
				'type'        => 'integer',
				'default'     => 100,
				'minimum'     => 1,
				'maximum'     => 500,
			),
		);
	}

	/**
	 * Find RSVP block in parsed blocks array
	 *
	 * @param array $blocks Parsed blocks from parse_blocks().
	 * @return array|null RSVP block data or null if not found.
	 */
	private function find_rsvp_block( $blocks ) {
		foreach ( $blocks as $block ) {
			if ( 'fair-rsvp/rsvp-button' === $block['blockName'] ) {
				return $block;
			}
			// Recursively search inner blocks.
			if ( ! empty( $block['innerBlocks'] ) ) {
				$found = $this->find_rsvp_block( $block['innerBlocks'] );
				if ( $found ) {
					return $found;
				}
			}
		}
		return null;
	}

	/**
	 * Get attendance check data for event
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function get_attendance_check( $request ) {
		$event_id = (int) $request->get_param( 'event_id' );

		// Validate post exists.
		$event = get_post( $event_id );
		if ( ! $event ) {
			return new WP_Error(
				'invalid_post',
				__( 'The specified post does not exist.', 'fair-rsvp' ),
				array( 'status' => 404 )
			);
		}

		// Check if post has RSVP block.
		if ( ! has_block( 'fair-rsvp/rsvp-button', $event ) ) {
			return new WP_Error(
				'no_rsvp_block',
				__( 'This post does not have an RSVP block.', 'fair-rsvp' ),
				array( 'status' => 404 )
			);
		}

		// Get participants with full user data (includes email for search).
		$yes_users   = $this->repository->get_participants_for_attendance_check( $event_id, 'yes' );
		$maybe_users = $this->repository->get_participants_for_attendance_check( $event_id, 'maybe' );

		// Get expected users from attendance block.
		$expected_users = $this->get_expected_users( $event, $yes_users, $maybe_users );

		return new WP_REST_Response(
			array(
				'yes'       => $yes_users,
				'maybe'     => $maybe_users,
				'expected'  => $expected_users,
				'post_url'  => get_permalink( $event ),
				'post_type' => $event->post_type,
			),
			200
		);
	}

	/**
	 * Format users from RSVP records
	 *
	 * @param array $rsvps RSVP records.
	 * @return array Formatted user data.
	 */
	private function format_users_from_rsvps( $rsvps ) {
		$users = array();

		foreach ( $rsvps as $rsvp ) {
			if ( ! $rsvp['user_id'] ) {
				continue; // Skip anonymous RSVPs.
			}

			$user = get_userdata( $rsvp['user_id'] );
			if ( ! $user ) {
				continue;
			}

			$users[] = array(
				'id'         => $user->ID,
				'name'       => $user->display_name,
				'email'      => $user->user_email,
				'avatar_url' => get_avatar_url( $user->ID ),
			);
		}

		return $users;
	}

	/**
	 * Get expected users who haven't RSVP'd yet
	 *
	 * @param \WP_Post $event Event post object.
	 * @param array    $yes_users Formatted yes user data.
	 * @param array    $maybe_users Formatted maybe user data.
	 * @return array Expected user data.
	 */
	private function get_expected_users( $event, $yes_users, $maybe_users ) {
		// Get attendance attribute from RSVP block.
		$blocks     = parse_blocks( $event->post_content );
		$rsvp_block = $this->find_rsvp_block( $blocks );
		$attendance = isset( $rsvp_block['attrs']['attendance'] ) ? $rsvp_block['attrs']['attendance'] : array();

		if ( empty( $attendance ) ) {
			return array();
		}

		// Get user IDs who have already RSVP'd.
		$rsvpd_user_ids = array();
		foreach ( array_merge( $yes_users, $maybe_users ) as $user ) {
			if ( isset( $user['id'] ) ) {
				$rsvpd_user_ids[] = (int) $user['id'];
			}
		}

		// Get all expected user IDs from attendance groups.
		$expected_user_ids = $this->get_expected_user_ids( $attendance );

		// Filter out users who already RSVP'd.
		$expected_user_ids = array_diff( $expected_user_ids, $rsvpd_user_ids );

		// Format user data.
		$expected_users = array();
		foreach ( $expected_user_ids as $user_id ) {
			$user = get_userdata( $user_id );
			if ( ! $user ) {
				continue;
			}

			$expected_users[] = array(
				'id'         => $user->ID,
				'name'       => $user->display_name,
				'email'      => $user->user_email,
				'avatar_url' => get_avatar_url( $user->ID, array( 'size' => 48 ) ),
			);
		}

		return $expected_users;
	}

	/**
	 * Get user IDs from attendance attribute (only expected groups)
	 *
	 * @param array $attendance Attendance attribute from block.
	 * @return array User IDs who are expected (permission level 2).
	 */
	private function get_expected_user_ids( $attendance ) {
		$expected_user_ids = array();

		foreach ( $attendance as $key => $permission_level ) {
			// Only process expected groups (level 2).
			if ( 2 !== (int) $permission_level ) {
				continue;
			}

			// Skip built-in keys.
			if ( in_array( $key, array( 'users', 'anonymous' ), true ) || 0 === strpos( $key, 'role:' ) ) {
				continue;
			}

			// This is a plugin-provided group - resolve it.
			if ( function_exists( 'fair_events_user_group_resolve' ) ) {
				$group_user_ids    = fair_events_user_group_resolve( $key, array() );
				$expected_user_ids = array_merge( $expected_user_ids, $group_user_ids );
			}
		}

		return array_unique( $expected_user_ids );
	}

	/**
	 * Check permissions for attendance check
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if the request has access, WP_Error object otherwise.
	 */
	public function get_attendance_check_permissions_check( $request ) {
		$event_id = (int) $request->get_param( 'event_id' );

		// User must be able to edit the event post.
		if ( ! current_user_can( 'edit_post', $event_id ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to view this attendance check.', 'fair-rsvp' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}
}
