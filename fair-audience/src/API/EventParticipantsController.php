<?php
/**
 * Event Participants REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\ParticipantRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for event-participant relationships.
 */
class EventParticipantsController extends WP_REST_Controller {

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
	protected $rest_base = 'events/(?P<event_id>\d+)/participants';

	/**
	 * Event participant repository.
	 *
	 * @var EventParticipantRepository
	 */
	private $event_participant_repo;

	/**
	 * Participant repository.
	 *
	 * @var ParticipantRepository
	 */
	private $participant_repo;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->event_participant_repo = new EventParticipantRepository();
		$this->participant_repo       = new ParticipantRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/events/{event_id}/participants
		// POST /fair-audience/v1/events/{event_id}/participants
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => 'is_user_logged_in',
					'args'                => array(
						'event_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'event_id'       => array(
							'type'     => 'integer',
							'required' => true,
						),
						'participant_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'label'          => array(
							'type'    => 'string',
							'enum'    => array( 'interested', 'signed_up' ),
							'default' => 'interested',
						),
					),
				),
			)
		);

		// DELETE /fair-audience/v1/events/{event_id}/participants/{participant_id}
		// PUT /fair-audience/v1/events/{event_id}/participants/{participant_id}
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<participant_id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'event_id'       => array(
							'type'     => 'integer',
							'required' => true,
						),
						'participant_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'label'          => array(
							'type'     => 'string',
							'enum'     => array( 'interested', 'signed_up' ),
							'required' => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'event_id'       => array(
							'type'     => 'integer',
							'required' => true,
						),
						'participant_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);

		// GET /fair-audience/v1/events (list events with participant counts)
		register_rest_route(
			$this->namespace,
			'/events',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_events' ),
				'permission_callback' => 'is_user_logged_in',
			)
		);
	}

	/**
	 * Get all participants for an event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_items( $request ) {
		$event_id = $request->get_param( 'event_id' );

		// Verify event exists.
		$event = get_post( $event_id );
		if ( ! $event || 'fair_event' !== $event->post_type ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$event_participants = $this->event_participant_repo->get_by_event( $event_id );

		$items = array_map(
			function ( $ep ) {
				$participant = $this->participant_repo->get_by_id( $ep->participant_id );
				return array(
					'id'                => $ep->id,
					'participant_id'    => $ep->participant_id,
					'participant_name'  => $participant ? $participant->name . ' ' . $participant->surname : '',
					'participant_email' => $participant ? $participant->email : '',
					'instagram'         => $participant ? $participant->instagram : '',
					'label'             => $ep->label,
					'created_at'        => $ep->created_at,
				);
			},
			$event_participants
		);

		return rest_ensure_response( $items );
	}

	/**
	 * Add participant to event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$event_id       = $request->get_param( 'event_id' );
		$participant_id = $request->get_param( 'participant_id' );
		$label          = $request->get_param( 'label' );

		// Validate event.
		$event = get_post( $event_id );
		if ( ! $event || 'fair_event' !== $event->post_type ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Validate participant.
		$participant = $this->participant_repo->get_by_id( $participant_id );
		if ( ! $participant ) {
			return new WP_Error(
				'invalid_participant',
				__( 'Participant not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$id = $this->event_participant_repo->add_participant_to_event( $event_id, $participant_id, $label );

		if ( false === $id ) {
			return new WP_Error(
				'creation_failed',
				__( 'Failed to add participant. May already exist.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		return rest_ensure_response(
			array(
				'id'      => $id,
				'message' => __( 'Participant added successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Update participant label.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function update_item( $request ) {
		$event_id       = $request->get_param( 'event_id' );
		$participant_id = $request->get_param( 'participant_id' );
		$label          = $request->get_param( 'label' );

		$success = $this->event_participant_repo->update_label( $event_id, $participant_id, $label );

		if ( ! $success ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update label.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		return rest_ensure_response(
			array(
				'message' => __( 'Label updated successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Remove participant from event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function delete_item( $request ) {
		$event_id       = $request->get_param( 'event_id' );
		$participant_id = $request->get_param( 'participant_id' );

		$success = $this->event_participant_repo->remove_participant_from_event( $event_id, $participant_id );

		if ( ! $success ) {
			return new WP_Error(
				'deletion_failed',
				__( 'Failed to remove participant.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		return rest_ensure_response(
			array(
				'message' => __( 'Participant removed successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Get all events with participant counts.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_events( $request ) {
		// Get all fair_event posts.
		$events = get_posts(
			array(
				'post_type'      => 'fair_event',
				'posts_per_page' => -1,
				'post_status'    => 'publish',
				'orderby'        => 'date',
				'order'          => 'DESC',
			)
		);

		$items = array_map(
			function ( $event ) {
				$counts = $this->event_participant_repo->get_label_counts_for_event( $event->ID );

				// Get event date metadata (from fair-events plugin).
				$event_date = get_post_meta( $event->ID, 'event_date', true );

				return array(
					'event_id'           => $event->ID,
					'title'              => $event->post_title,
					'link'               => get_permalink( $event->ID ),
					'event_date'         => $event_date,
					'participant_counts' => $counts,
				);
			},
			$events
		);

		return rest_ensure_response( $items );
	}

	/**
	 * Check permissions for creating.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function create_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for updating.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function update_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for deleting.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function delete_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
