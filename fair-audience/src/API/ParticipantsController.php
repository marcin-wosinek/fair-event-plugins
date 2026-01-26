<?php
/**
 * Participants REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Models\Participant;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for participants.
 */
class ParticipantsController extends WP_REST_Controller {

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
	protected $rest_base = 'participants';

	/**
	 * Repository instance.
	 *
	 * @var ParticipantRepository
	 */
	private $repository;

	/**
	 * Event participant repository instance.
	 *
	 * @var EventParticipantRepository
	 */
	private $event_participant_repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository                   = new ParticipantRepository();
		$this->event_participant_repository = new EventParticipantRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/participants.
		// POST /fair-audience/v1/participants.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => 'is_user_logged_in',
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => $this->get_endpoint_args_for_item_schema( WP_REST_Server::CREATABLE ),
				),
			)
		);

		// GET /fair-audience/v1/participants/{id}.
		// PUT /fair-audience/v1/participants/{id}.
		// DELETE /fair-audience/v1/participants/{id}.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => 'is_user_logged_in',
					'args'                => array(
						'id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => $this->get_endpoint_args_for_item_schema( WP_REST_Server::EDITABLE ),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Get all participants.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_items( $request ) {
		$per_page = $request->get_param( 'per_page' );
		$page     = $request->get_param( 'page' );

		$args = array(
			'search'        => $request->get_param( 'search' ) ?? '',
			'email_profile' => $request->get_param( 'email_profile' ) ?? '',
			'status'        => $request->get_param( 'status' ) ?? '',
			'orderby'       => $request->get_param( 'orderby' ) ?? 'surname',
			'order'         => $request->get_param( 'order' ) ?? 'ASC',
			'per_page'      => $per_page ? (int) $per_page : 0,
			'page'          => $page ? (int) $page : 1,
		);

		$participants = $this->repository->get_filtered( $args );
		$total        = $this->repository->get_filtered_count( $args );

		// Get event counts for all participants in one query.
		$participant_ids = array_map(
			function ( $p ) {
				return $p->id;
			},
			$participants
		);
		$event_counts    = $this->event_participant_repository->get_event_counts_for_participants( $participant_ids );

		$items = array_map(
			function ( $participant ) use ( $request, $event_counts ) {
				$item = $this->prepare_item_for_response( $participant, $request );

				// Add event counts.
				$counts                      = $event_counts[ $participant->id ] ?? array(
					'interested'   => 0,
					'signed_up'    => 0,
					'collaborator' => 0,
				);
				$item['events_signed_up']    = $counts['signed_up'];
				$item['events_collaborated'] = $counts['collaborator'];
				$item['events_interested']   = $counts['interested'];

				return $item;
			},
			$participants
		);

		$response = rest_ensure_response( $items );

		// Add pagination headers.
		$response->header( 'X-WP-Total', $total );
		if ( $args['per_page'] > 0 ) {
			$total_pages = (int) ceil( $total / $args['per_page'] );
			$response->header( 'X-WP-TotalPages', $total_pages );
		}

		return $response;
	}

	/**
	 * Get single participant.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_item( $request ) {
		$id          = $request->get_param( 'id' );
		$participant = $this->repository->get_by_id( $id );

		if ( ! $participant ) {
			return new WP_Error(
				'participant_not_found',
				__( 'Participant not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		return rest_ensure_response( $this->prepare_item_for_response( $participant, $request ) );
	}

	/**
	 * Create participant.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		global $wpdb;

		// Normalize email: convert empty string to null.
		$email = $this->normalize_email( $request->get_param( 'email' ) );

		$participant = new Participant();
		$participant->populate(
			array(
				'name'          => $request->get_param( 'name' ),
				'surname'       => $request->get_param( 'surname' ),
				'email'         => $email,
				'instagram'     => $request->get_param( 'instagram' ),
				'email_profile' => $request->get_param( 'email_profile' ),
			)
		);

		// Check if email already exists (only if email is provided).
		if ( ! empty( $participant->email ) ) {
			$existing = $this->repository->get_by_email( $participant->email );
			if ( $existing ) {
				return new WP_Error(
					'email_exists',
					__( 'A participant with this email already exists.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}
		}

		// Suppress wpdb error output and capture any DB errors.
		$wpdb->suppress_errors( true );
		$last_error_before = $wpdb->last_error;

		$result = $participant->save();

		$wpdb->suppress_errors( false );
		$db_error = $wpdb->last_error;

		if ( ! $result ) {
			$error_message = __( 'Failed to create participant.', 'fair-audience' );
			if ( $db_error && $db_error !== $last_error_before ) {
				$error_message .= ' ' . $db_error;
			}
			return new WP_Error(
				'creation_failed',
				$error_message,
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'id'      => $participant->id,
				'message' => __( 'Participant created successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Update participant.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function update_item( $request ) {
		global $wpdb;

		$id          = $request->get_param( 'id' );
		$participant = $this->repository->get_by_id( $id );

		if ( ! $participant ) {
			return new WP_Error(
				'participant_not_found',
				__( 'Participant not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Normalize email: convert empty string to null.
		$new_email = $this->normalize_email( $request->get_param( 'email' ) );

		// Check email uniqueness if changed (only if new email is provided and not empty).
		if ( ! empty( $new_email ) && $new_email !== $participant->email ) {
			$existing = $this->repository->get_by_email( $new_email );
			if ( $existing && $existing->id !== $participant->id ) {
				return new WP_Error(
					'email_exists',
					__( 'A participant with this email already exists.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}
		}

		$participant->populate(
			array(
				'id'            => $participant->id,
				'name'          => $request->get_param( 'name' ),
				'surname'       => $request->get_param( 'surname' ),
				'email'         => $new_email,
				'instagram'     => $request->get_param( 'instagram' ),
				'email_profile' => $request->get_param( 'email_profile' ),
			)
		);

		// Suppress wpdb error output and capture any DB errors.
		$wpdb->suppress_errors( true );
		$last_error_before = $wpdb->last_error;

		$result = $participant->save();

		$wpdb->suppress_errors( false );
		$db_error = $wpdb->last_error;

		if ( ! $result ) {
			$error_message = __( 'Failed to update participant.', 'fair-audience' );
			if ( $db_error && $db_error !== $last_error_before ) {
				$error_message .= ' ' . $db_error;
			}
			return new WP_Error(
				'update_failed',
				$error_message,
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'id'      => $participant->id,
				'message' => __( 'Participant updated successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Delete participant.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function delete_item( $request ) {
		$id          = $request->get_param( 'id' );
		$participant = $this->repository->get_by_id( $id );

		if ( ! $participant ) {
			return new WP_Error(
				'participant_not_found',
				__( 'Participant not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		if ( ! $participant->delete() ) {
			return new WP_Error(
				'deletion_failed',
				__( 'Failed to delete participant.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'message' => __( 'Participant deleted successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Prepare item for response.
	 *
	 * @param Participant     $participant Participant model.
	 * @param WP_REST_Request $request     Request object.
	 * @return array Response data.
	 */
	public function prepare_item_for_response( $participant, $request ) {
		return array(
			'id'            => $participant->id,
			'name'          => $participant->name,
			'surname'       => $participant->surname,
			'email'         => $participant->email,
			'instagram'     => $participant->instagram,
			'email_profile' => $participant->email_profile,
			'status'        => $participant->status,
			'created_at'    => $participant->created_at,
			'updated_at'    => $participant->updated_at,
		);
	}

	/**
	 * Normalize email value: convert empty strings to null.
	 *
	 * @param string|null $email Email value from request.
	 * @return string|null Normalized email or null if empty.
	 */
	private function normalize_email( $email ) {
		if ( null === $email || '' === $email || '' === trim( $email ) ) {
			return null;
		}
		return $email;
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
