<?php
/**
 * Groups REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\GroupRepository;
use FairAudience\Database\GroupParticipantRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Models\Group;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for groups.
 */
class GroupsController extends WP_REST_Controller {

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
	protected $rest_base = 'groups';

	/**
	 * Repository instance.
	 *
	 * @var GroupRepository
	 */
	private $repository;

	/**
	 * Group participant repository instance.
	 *
	 * @var GroupParticipantRepository
	 */
	private $group_participant_repository;

	/**
	 * Participant repository instance.
	 *
	 * @var ParticipantRepository
	 */
	private $participant_repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository                   = new GroupRepository();
		$this->group_participant_repository = new GroupParticipantRepository();
		$this->participant_repository       = new ParticipantRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/groups.
		// POST /fair-audience/v1/groups.
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
				),
			)
		);

		// GET /fair-audience/v1/groups/{id}.
		// PUT /fair-audience/v1/groups/{id}.
		// DELETE /fair-audience/v1/groups/{id}.
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
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
				),
			)
		);

		// GET /fair-audience/v1/groups/{id}/participants.
		// POST /fair-audience/v1/groups/{id}/participants.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/participants',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_group_participants' ),
					'permission_callback' => 'is_user_logged_in',
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'add_participant_to_group' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
				),
			)
		);

		// DELETE /fair-audience/v1/groups/{id}/participants/{participant_id}.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/participants/(?P<participant_id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'remove_participant_from_group' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
				),
			)
		);
	}

	/**
	 * Get all groups.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_items( $request ) {
		$orderby = $request->get_param( 'orderby' ) ?? 'name';
		$order   = $request->get_param( 'order' ) ?? 'ASC';

		$groups = $this->repository->get_all_with_member_counts( $orderby, $order );
		$total  = count( $groups );

		$items = array_map(
			function ( $group ) use ( $request ) {
				$item                 = $this->prepare_item_for_response( $group, $request );
				$item['member_count'] = $group->member_count ?? 0;
				return $item;
			},
			$groups
		);

		$response = rest_ensure_response( $items );
		$response->header( 'X-WP-Total', $total );

		return $response;
	}

	/**
	 * Get single group.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_item( $request ) {
		$id    = $request->get_param( 'id' );
		$group = $this->repository->get_by_id( $id );

		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$item                 = $this->prepare_item_for_response( $group, $request );
		$item['member_count'] = $this->group_participant_repository->get_member_count( $id );

		return rest_ensure_response( $item );
	}

	/**
	 * Create group.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$name = $request->get_param( 'name' );

		if ( empty( $name ) ) {
			return new WP_Error(
				'missing_name',
				__( 'Group name is required.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Check if group with same name already exists.
		$existing = $this->repository->get_by_name( $name );
		if ( $existing ) {
			return new WP_Error(
				'name_exists',
				__( 'A group with this name already exists.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$group = new Group();
		$group->populate(
			array(
				'name'        => $name,
				'description' => $request->get_param( 'description' ) ?? '',
			)
		);

		if ( ! $group->save() ) {
			return new WP_Error(
				'creation_failed',
				__( 'Failed to create group.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'id'      => $group->id,
				'message' => __( 'Group created successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Update group.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function update_item( $request ) {
		$id    = $request->get_param( 'id' );
		$group = $this->repository->get_by_id( $id );

		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$new_name = $request->get_param( 'name' );

		// Check if new name already exists for another group.
		if ( $new_name && $new_name !== $group->name ) {
			$existing = $this->repository->get_by_name( $new_name );
			if ( $existing && $existing->id !== $group->id ) {
				return new WP_Error(
					'name_exists',
					__( 'A group with this name already exists.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}
		}

		$group->populate(
			array(
				'id'          => $group->id,
				'name'        => $new_name ?? $group->name,
				'description' => $request->get_param( 'description' ) ?? $group->description,
			)
		);

		if ( ! $group->save() ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update group.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'id'      => $group->id,
				'message' => __( 'Group updated successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Delete group.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function delete_item( $request ) {
		$id    = $request->get_param( 'id' );
		$group = $this->repository->get_by_id( $id );

		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		if ( ! $group->delete() ) {
			return new WP_Error(
				'deletion_failed',
				__( 'Failed to delete group.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'message' => __( 'Group deleted successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Get participants for a group.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_group_participants( $request ) {
		$group_id = $request->get_param( 'id' );
		$group    = $this->repository->get_by_id( $group_id );

		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$members = $this->group_participant_repository->get_members_with_details( $group_id );

		return rest_ensure_response( $members );
	}

	/**
	 * Add participant to group.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function add_participant_to_group( $request ) {
		$group_id       = $request->get_param( 'id' );
		$participant_id = $request->get_param( 'participant_id' );

		$group = $this->repository->get_by_id( $group_id );
		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$participant = $this->participant_repository->get_by_id( $participant_id );
		if ( ! $participant ) {
			return new WP_Error(
				'participant_not_found',
				__( 'Participant not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Check if already a member.
		$existing = $this->group_participant_repository->get_by_group_and_participant( $group_id, $participant_id );
		if ( $existing ) {
			return new WP_Error(
				'already_member',
				__( 'Participant is already a member of this group.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$result = $this->group_participant_repository->add_participant_to_group( $group_id, $participant_id );
		if ( ! $result ) {
			return new WP_Error(
				'add_failed',
				__( 'Failed to add participant to group.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'id'      => $result,
				'message' => __( 'Participant added to group successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Remove participant from group.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function remove_participant_from_group( $request ) {
		$group_id       = $request->get_param( 'id' );
		$participant_id = $request->get_param( 'participant_id' );

		$group = $this->repository->get_by_id( $group_id );
		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$result = $this->group_participant_repository->remove_participant_from_group( $group_id, $participant_id );
		if ( ! $result ) {
			return new WP_Error(
				'remove_failed',
				__( 'Participant is not a member of this group.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		return rest_ensure_response(
			array(
				'message' => __( 'Participant removed from group successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Prepare item for response.
	 *
	 * @param Group           $group   Group model.
	 * @param WP_REST_Request $request Request object.
	 * @return array Response data.
	 */
	public function prepare_item_for_response( $group, $request ) {
		return array(
			'id'          => $group->id,
			'name'        => $group->name,
			'description' => $group->description,
			'created_at'  => $group->created_at,
			'updated_at'  => $group->updated_at,
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
