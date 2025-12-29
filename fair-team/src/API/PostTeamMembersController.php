<?php
/**
 * PostTeamMembers REST API Controller
 *
 * @package FairTeam
 */

namespace FairTeam\API;

use FairTeam\Database\PostTeamMemberRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for post-team member relationships.
 *
 * Provides endpoints for managing team member relationships with posts.
 */
class PostTeamMembersController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-team/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'posts/(?P<post_id>\d+)/team-members';

	/**
	 * Repository instance.
	 *
	 * @var PostTeamMemberRepository
	 */
	private $repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository = new PostTeamMemberRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-team/v1/posts/{post_id}/team-members
		// POST /fair-team/v1/posts/{post_id}/team-members
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => 'is_user_logged_in',
					'args'                => array(
						'post_id' => array(
							'description' => __( 'Post ID.', 'fair-team' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'post_id'        => array(
							'type'     => 'integer',
							'required' => true,
						),
						'team_member_id' => array(
							'description' => __( 'Team member post ID.', 'fair-team' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);

		// DELETE /fair-team/v1/posts/{post_id}/team-members/{team_member_id}
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<team_member_id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'post_id'        => array(
							'type'     => 'integer',
							'required' => true,
						),
						'team_member_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Get all team members for a post.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_items( $request ) {
		$post_id = $request->get_param( 'post_id' );

		// Verify post exists and is not a team member.
		$post = get_post( $post_id );
		if ( ! $post || 'fair_team_member' === $post->post_type ) {
			return new WP_Error(
				'invalid_post',
				__( 'Post not found or invalid type.', 'fair-team' ),
				array( 'status' => 404 )
			);
		}

		$team_members = $this->repository->get_by_post( $post_id );

		$items = array_map(
			function ( $ptm ) {
				$team_member   = get_post( $ptm->team_member_id );
				$instagram_url = get_post_meta( $ptm->team_member_id, 'team_member_instagram', true );

				// Extract Instagram handle from URL
				$instagram_handle = '';
				if ( ! empty( $instagram_url ) && preg_match( '/instagram\.com\/([^\/\?]+)/', $instagram_url, $matches ) ) {
					$instagram_handle = $matches[1];
				}

				return array(
					'id'               => $ptm->id,
					'team_member_id'   => $ptm->team_member_id,
					'team_member_name' => $team_member ? $team_member->post_title : '',
					'instagram_url'    => $instagram_url,
					'instagram_handle' => $instagram_handle,
				);
			},
			$team_members
		);

		return rest_ensure_response( $items );
	}

	/**
	 * Create a team member relationship.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$post_id        = $request->get_param( 'post_id' );
		$team_member_id = $request->get_param( 'team_member_id' );

		// Validate post.
		$post = get_post( $post_id );
		if ( ! $post || 'fair_team_member' === $post->post_type ) {
			return new WP_Error(
				'invalid_post',
				__( 'Post not found or invalid type.', 'fair-team' ),
				array( 'status' => 404 )
			);
		}

		// Validate team member.
		$team_member = get_post( $team_member_id );
		if ( ! $team_member || 'fair_team_member' !== $team_member->post_type ) {
			return new WP_Error(
				'invalid_team_member',
				__( 'Team member not found.', 'fair-team' ),
				array( 'status' => 404 )
			);
		}

		$id = $this->repository->add_team_member_to_post( $post_id, $team_member_id );

		if ( false === $id ) {
			return new WP_Error(
				'creation_failed',
				__( 'Failed to add team member. May already exist.', 'fair-team' ),
				array( 'status' => 400 )
			);
		}

		return rest_ensure_response(
			array(
				'id'      => $id,
				'message' => __( 'Team member added successfully.', 'fair-team' ),
			)
		);
	}

	/**
	 * Delete a team member relationship.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function delete_item( $request ) {
		$post_id        = $request->get_param( 'post_id' );
		$team_member_id = $request->get_param( 'team_member_id' );

		$success = $this->repository->remove_team_member_from_post( $post_id, $team_member_id );

		if ( ! $success ) {
			return new WP_Error(
				'deletion_failed',
				__( 'Failed to remove team member.', 'fair-team' ),
				array( 'status' => 400 )
			);
		}

		return rest_ensure_response(
			array(
				'message' => __( 'Team member removed successfully.', 'fair-team' ),
			)
		);
	}

	/**
	 * Check permissions for creating a relationship.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user can edit the post.
	 */
	public function create_item_permissions_check( $request ) {
		$post_id = $request->get_param( 'post_id' );
		return current_user_can( 'edit_post', $post_id );
	}

	/**
	 * Check permissions for deleting a relationship.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user can edit the post.
	 */
	public function delete_item_permissions_check( $request ) {
		$post_id = $request->get_param( 'post_id' );
		return current_user_can( 'edit_post', $post_id );
	}
}
