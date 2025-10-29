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
		$user_id     = get_current_user_id();

		// Validate event exists and is published.
		$event = get_post( $event_id );
		if ( ! $event || 'publish' !== $event->post_status ) {
			return new WP_Error(
				'invalid_event',
				__( 'The specified event does not exist or is not published.', 'fair-rsvp' ),
				array( 'status' => 400 )
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
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in to RSVP.', 'fair-rsvp' ),
				array( 'status' => 401 )
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
			'rsvp_at'           => $rsvp['rsvp_at'],
			'created_at'        => $rsvp['created_at'],
			'updated_at'        => $rsvp['updated_at'],
		);

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
}
