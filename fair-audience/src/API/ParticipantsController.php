<?php
/**
 * Participants REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ParticipantRepository;
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
	 * Constructor.
	 */
	public function __construct() {
		$this->repository = new ParticipantRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/participants
		// POST /fair-audience/v1/participants
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

		// GET /fair-audience/v1/participants/{id}
		// PUT /fair-audience/v1/participants/{id}
		// DELETE /fair-audience/v1/participants/{id}
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
		$search = $request->get_param( 'search' );

		if ( $search ) {
			$participants = $this->repository->search( $search );
		} else {
			$participants = $this->repository->get_all();
		}

		$items = array_map(
			function ( $participant ) use ( $request ) {
				return $this->prepare_item_for_response( $participant, $request );
			},
			$participants
		);

		return rest_ensure_response( $items );
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
		$participant = new Participant();
		$participant->populate(
			array(
				'name'          => $request->get_param( 'name' ),
				'surname'       => $request->get_param( 'surname' ),
				'email'         => $request->get_param( 'email' ),
				'instagram'     => $request->get_param( 'instagram' ),
				'email_profile' => $request->get_param( 'email_profile' ),
			)
		);

		// Check if email already exists.
		$existing = $this->repository->get_by_email( $participant->email );
		if ( $existing ) {
			return new WP_Error(
				'email_exists',
				__( 'A participant with this email already exists.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		if ( ! $participant->save() ) {
			return new WP_Error(
				'creation_failed',
				__( 'Failed to create participant.', 'fair-audience' ),
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
		$id          = $request->get_param( 'id' );
		$participant = $this->repository->get_by_id( $id );

		if ( ! $participant ) {
			return new WP_Error(
				'participant_not_found',
				__( 'Participant not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Check email uniqueness if changed.
		$new_email = $request->get_param( 'email' );
		if ( $new_email && $new_email !== $participant->email ) {
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

		if ( ! $participant->save() ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update participant.', 'fair-audience' ),
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
	 * @param Participant         $participant Participant model.
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
			'created_at'    => $participant->created_at,
			'updated_at'    => $participant->updated_at,
		);
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
