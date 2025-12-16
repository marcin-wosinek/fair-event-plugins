<?php
/**
 * Group REST API Controller for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\API;

use FairMembership\Models\Group;
use FairMembership\Utils\DebugLogger;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Group REST API Controller
 */
class GroupController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-membership/v1';

	/**
	 * REST base for groups
	 *
	 * @var string
	 */
	protected $rest_base = 'groups';

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-membership/v1/groups - List all groups
		// POST /fair-membership/v1/groups - Create group
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'status'   => array(
							'description' => __( 'Filter by status.', 'fair-membership' ),
							'type'        => 'string',
							'enum'        => array( 'active', 'inactive' ),
						),
						'page'     => array(
							'description' => __( 'Page number.', 'fair-membership' ),
							'type'        => 'integer',
							'default'     => 1,
						),
						'per_page' => array(
							'description' => __( 'Items per page.', 'fair-membership' ),
							'type'        => 'integer',
							'default'     => 50,
						),
						'orderby'  => array(
							'description' => __( 'Order by field.', 'fair-membership' ),
							'type'        => 'string',
							'default'     => 'name',
							'enum'        => array( 'name', 'created_at', 'updated_at' ),
						),
						'order'    => array(
							'description' => __( 'Order direction.', 'fair-membership' ),
							'type'        => 'string',
							'default'     => 'ASC',
							'enum'        => array( 'ASC', 'DESC' ),
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => $this->get_endpoint_args_for_item_schema( WP_REST_Server::CREATABLE ),
				),
			)
		);

		// GET /fair-membership/v1/groups/{id} - Get single group
		// PUT /fair-membership/v1/groups/{id} - Update group
		// DELETE /fair-membership/v1/groups/{id} - Delete group
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Group ID.', 'fair-membership' ),
							'type'        => 'integer',
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
							'description' => __( 'Group ID.', 'fair-membership' ),
							'type'        => 'integer',
						),
					),
				),
			)
		);

		// GET /fair-membership/v1/groups/{id}/members - Get group members
		// POST /fair-membership/v1/groups/{id}/members - Add member to group
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/members',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_group_members' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Group ID.', 'fair-membership' ),
							'type'        => 'integer',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'add_group_member' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'id'      => array(
							'description' => __( 'Group ID.', 'fair-membership' ),
							'type'        => 'integer',
						),
						'user_id' => array(
							'description' => __( 'User ID to add to the group.', 'fair-membership' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);

		// DELETE /fair-membership/v1/groups/{id}/members/{user_id} - Remove member from group
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/members/(?P<user_id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'remove_group_member' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'id'      => array(
							'description' => __( 'Group ID.', 'fair-membership' ),
							'type'        => 'integer',
						),
						'user_id' => array(
							'description' => __( 'User ID to remove from the group.', 'fair-membership' ),
							'type'        => 'integer',
						),
					),
				),
			)
		);

		// POST /fair-membership/v1/groups/{id}/send-email - Send email to group members
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/send-email',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'send_group_email' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'id'      => array(
							'description' => __( 'Group ID.', 'fair-membership' ),
							'type'        => 'integer',
						),
						'subject' => array(
							'description' => __( 'Email subject.', 'fair-membership' ),
							'type'        => 'string',
							'required'    => true,
						),
						'message' => array(
							'description' => __( 'Email message body.', 'fair-membership' ),
							'type'        => 'string',
							'required'    => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Get all groups
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$page     = (int) $request->get_param( 'page' );
		$per_page = (int) $request->get_param( 'per_page' );
		$status   = $request->get_param( 'status' );
		$orderby  = $request->get_param( 'orderby' );
		$order    = $request->get_param( 'order' );

		$offset = ( $page - 1 ) * $per_page;

		$args = array(
			'orderby' => $orderby,
			'order'   => $order,
			'limit'   => $per_page,
			'offset'  => $offset,
		);

		if ( ! empty( $status ) ) {
			$args['status'] = $status;
		}

		$groups = Group::get_all( $args );
		$total  = Group::count( ! empty( $status ) ? array( 'status' => $status ) : array() );

		$items = array_map(
			function ( $group ) {
				return $group->to_array( true ); // Include member count
			},
			$groups
		);

		return new WP_REST_Response(
			array(
				'items'       => $items,
				'total'       => $total,
				'page'        => $page,
				'per_page'    => $per_page,
				'total_pages' => ceil( $total / $per_page ),
			),
			200
		);
	}

	/**
	 * Get single group
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		$group = Group::get_by_id( $id );

		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $group->to_array( true ), 200 );
	}

	/**
	 * Create group
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$params = $request->get_params();

		// Create new group
		$group                 = new Group();
		$group->name           = isset( $params['name'] ) ? sanitize_text_field( $params['name'] ) : '';
		$group->slug           = isset( $params['slug'] ) ? sanitize_title( $params['slug'] ) : '';
		$group->description    = isset( $params['description'] ) ? sanitize_textarea_field( $params['description'] ) : '';
		$group->access_control = isset( $params['access_control'] ) ? sanitize_text_field( $params['access_control'] ) : 'open';
		$group->status         = isset( $params['status'] ) ? sanitize_text_field( $params['status'] ) : 'active';
		$group->created_by     = get_current_user_id();

		// Auto-generate slug from name if not provided
		if ( empty( $group->slug ) && ! empty( $group->name ) ) {
			$group->slug = sanitize_title( $group->name );
		}

		// Validate
		$validation_errors = $group->validate();
		if ( ! empty( $validation_errors ) ) {
			return new WP_Error(
				'group_validation_failed',
				implode( ' ', $validation_errors ),
				array( 'status' => 400 )
			);
		}

		// Save
		$result = $group->save();

		if ( $result ) {
			return new WP_REST_Response(
				array(
					'id'      => $group->id,
					'group'   => $group->to_array(),
					'message' => __( 'Group created successfully.', 'fair-membership' ),
				),
				201
			);
		} else {
			return new WP_Error(
				'group_save_failed',
				__( 'Failed to save group.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}
	}

	/**
	 * Update group
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$id     = (int) $request->get_param( 'id' );
		$params = $request->get_params();

		// Get existing group
		$group = Group::get_by_id( $id );

		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Update fields
		if ( isset( $params['name'] ) ) {
			$group->name = sanitize_text_field( $params['name'] );
		}
		if ( isset( $params['slug'] ) ) {
			$group->slug = sanitize_title( $params['slug'] );
		}
		if ( isset( $params['description'] ) ) {
			$group->description = sanitize_textarea_field( $params['description'] );
		}
		if ( isset( $params['access_control'] ) ) {
			$group->access_control = sanitize_text_field( $params['access_control'] );
		}
		if ( isset( $params['status'] ) ) {
			$group->status = sanitize_text_field( $params['status'] );
		}

		// Validate
		$validation_errors = $group->validate();
		if ( ! empty( $validation_errors ) ) {
			return new WP_Error(
				'group_validation_failed',
				implode( ' ', $validation_errors ),
				array( 'status' => 400 )
			);
		}

		// Save
		$result = $group->save();

		if ( $result ) {
			return new WP_REST_Response(
				array(
					'id'      => $group->id,
					'group'   => $group->to_array(),
					'message' => __( 'Group updated successfully.', 'fair-membership' ),
				),
				200
			);
		} else {
			return new WP_Error(
				'group_save_failed',
				__( 'Failed to update group.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}
	}

	/**
	 * Delete group
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		// Get group
		$group = Group::get_by_id( $id );

		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Delete
		$result = $group->delete();

		if ( $result ) {
			return new WP_REST_Response(
				array(
					'deleted' => true,
					'message' => __( 'Group deleted successfully.', 'fair-membership' ),
				),
				200
			);
		} else {
			return new WP_Error(
				'group_delete_failed',
				__( 'Failed to delete group.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}
	}

	/**
	 * Get group members
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_group_members( $request ) {
		$id = (int) $request->get_param( 'id' );

		// Verify group exists
		$group = Group::get_by_id( $id );
		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Get active memberships
		$memberships = \FairMembership\Models\Membership::get_active_by_group( $id );

		// Build members array with user data
		$members = array();
		foreach ( $memberships as $membership ) {
			$user = $membership->get_user();
			if ( $user ) {
				$members[] = array(
					'id'            => $user->ID,
					'name'          => $user->display_name,
					'email'         => $user->user_email,
					'login'         => $user->user_login,
					'started_at'    => $membership->started_at,
					'membership_id' => $membership->id,
				);
			}
		}

		return new WP_REST_Response(
			array(
				'group'   => $group->to_array(),
				'members' => $members,
			),
			200
		);
	}

	/**
	 * Add member to group
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function add_group_member( $request ) {
		$group_id = (int) $request->get_param( 'id' );
		$user_id  = (int) $request->get_param( 'user_id' );

		// Verify group exists
		$group = Group::get_by_id( $group_id );
		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Verify user exists
		$user = get_userdata( $user_id );
		if ( ! $user ) {
			return new WP_Error(
				'user_not_found',
				__( 'User not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Check if already a member
		$existing = \FairMembership\Models\Membership::get_active_by_user_and_group( $user_id, $group_id );
		if ( $existing ) {
			return new WP_Error(
				'already_member',
				__( 'User is already a member of this group.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		// Create membership
		$membership             = new \FairMembership\Models\Membership();
		$membership->user_id    = $user_id;
		$membership->group_id   = $group_id;
		$membership->status     = 'active';
		$membership->started_at = current_time( 'mysql' );

		$result = $membership->save();

		if ( $result ) {
			return new WP_REST_Response(
				array(
					'success' => true,
					'message' => __( 'Member added successfully.', 'fair-membership' ),
					'member'  => array(
						'id'            => $user->ID,
						'name'          => $user->display_name,
						'email'         => $user->user_email,
						'login'         => $user->user_login,
						'started_at'    => $membership->started_at,
						'membership_id' => $membership->id,
					),
				),
				201
			);
		} else {
			return new WP_Error(
				'membership_save_failed',
				__( 'Failed to add member.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}
	}

	/**
	 * Remove member from group
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function remove_group_member( $request ) {
		$group_id = (int) $request->get_param( 'id' );
		$user_id  = (int) $request->get_param( 'user_id' );

		// Verify group exists
		$group = Group::get_by_id( $group_id );
		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Get active membership
		$membership = \FairMembership\Models\Membership::get_active_by_user_and_group( $user_id, $group_id );
		if ( ! $membership ) {
			return new WP_Error(
				'membership_not_found',
				__( 'User is not a member of this group.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// End membership
		$membership->end();
		$result = $membership->save();

		if ( $result ) {
			return new WP_REST_Response(
				array(
					'success' => true,
					'message' => __( 'Member removed successfully.', 'fair-membership' ),
				),
				200
			);
		} else {
			return new WP_Error(
				'membership_end_failed',
				__( 'Failed to remove member.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}
	}

	/**
	 * Send email to group members
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function send_group_email( $request ) {
		$group_id = (int) $request->get_param( 'id' );
		$subject  = sanitize_text_field( $request->get_param( 'subject' ) );
		$message  = wp_kses_post( $request->get_param( 'message' ) );

		// Verify group exists
		$group = Group::get_by_id( $group_id );
		if ( ! $group ) {
			return new WP_Error(
				'group_not_found',
				__( 'Group not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Get active memberships
		$memberships = \FairMembership\Models\Membership::get_active_by_group( $group_id );

		if ( empty( $memberships ) ) {
			return new WP_Error(
				'no_members',
				__( 'This group has no members.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		// Send emails
		$sent_count    = 0;
		$failed_count  = 0;
		$failed_emails = array();

		foreach ( $memberships as $membership ) {
			$user = $membership->get_user();
			if ( $user && $user->user_email ) {
				$headers = array( 'Content-Type: text/html; charset=UTF-8' );
				$result  = wp_mail( $user->user_email, $subject, $message, $headers );

				if ( $result ) {
					++$sent_count;
				} else {
					++$failed_count;
					$failed_emails[] = $user->user_email;
				}
			}
		}

		// Log failed emails if any
		if ( $failed_count > 0 ) {
			DebugLogger::log_with_context(
				sprintf( 'Failed to send %d group email(s)', $failed_count ),
				array(
					'group_id'      => $group_id,
					'group_name'    => $group->name,
					'failed_count'  => $failed_count,
					'failed_emails' => $failed_emails,
					'subject'       => $subject,
				)
			);
		}

		return new WP_REST_Response(
			array(
				'success'      => true,
				'message'      => sprintf(
					// translators: %1$d is the number of emails sent, %2$d is the number that failed.
					__( 'Sent %1$d emails. %2$d failed.', 'fair-membership' ),
					$sent_count,
					$failed_count
				),
				'sent_count'   => $sent_count,
				'failed_count' => $failed_count,
			),
			200
		);
	}

	/**
	 * Get endpoint args for item schema
	 *
	 * @param string $method HTTP method.
	 * @return array
	 */
	public function get_endpoint_args_for_item_schema( $method = WP_REST_Server::CREATABLE ) {
		$args = array(
			'name'           => array(
				'description' => __( 'Group name.', 'fair-membership' ),
				'type'        => 'string',
				'required'    => true,
			),
			'slug'           => array(
				'description' => __( 'Group slug (auto-generated from name if not provided).', 'fair-membership' ),
				'type'        => 'string',
				'required'    => false,
			),
			'description'    => array(
				'description' => __( 'Group description.', 'fair-membership' ),
				'type'        => 'string',
				'required'    => false,
			),
			'access_control' => array(
				'description' => __( 'Access control type.', 'fair-membership' ),
				'type'        => 'string',
				'enum'        => array( 'open', 'managed' ),
				'default'     => 'open',
			),
			'status'         => array(
				'description' => __( 'Group status.', 'fair-membership' ),
				'type'        => 'string',
				'enum'        => array( 'active', 'inactive' ),
				'default'     => 'active',
			),
		);

		if ( WP_REST_Server::EDITABLE === $method ) {
			// For updates, make all fields optional
			foreach ( $args as $key => $arg ) {
				$args[ $key ]['required'] = false;
			}
		}

		return $args;
	}

	/**
	 * Permission checks
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	public function get_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	public function create_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	public function update_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	public function delete_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
