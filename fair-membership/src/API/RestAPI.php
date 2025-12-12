<?php
/**
 * REST API for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\API;

use FairMembership\Models\Group;
use FairMembership\Models\Membership;
use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * REST API class
 */
class RestAPI extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-membership/v1';

	/**
	 * Constructor - registers REST API routes
	 */
	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		// Get all groups
		register_rest_route(
			$this->namespace,
			'/groups',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_groups' ),
					'permission_callback' => array( $this, 'check_permission' ),
				),
			)
		);

		// Get users with memberships
		register_rest_route(
			$this->namespace,
			'/users-with-memberships',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_users_with_memberships' ),
					'permission_callback' => array( $this, 'check_permission' ),
				),
			)
		);

		// Update membership
		register_rest_route(
			$this->namespace,
			'/membership',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'update_membership' ),
					'permission_callback' => array( $this, 'check_permission' ),
					'args'                => array(
						'user_id'  => array(
							'required'          => true,
							'type'              => 'integer',
							'validate_callback' => function ( $param ) {
								return is_numeric( $param );
							},
						),
						'group_id' => array(
							'required'          => true,
							'type'              => 'integer',
							'validate_callback' => function ( $param ) {
								return is_numeric( $param );
							},
						),
						'status'   => array(
							'required'          => true,
							'type'              => 'string',
							'validate_callback' => function ( $param ) {
								return in_array( $param, array( 'active', 'inactive' ), true );
							},
						),
					),
				),
			)
		);
	}

	/**
	 * Check if user has permission to access the API
	 *
	 * @return bool
	 */
	public function check_permission() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Get all groups
	 *
	 * @return \WP_REST_Response
	 */
	public function get_groups() {
		$groups = Group::get_all( array( 'status' => 'active' ) );

		$data = array_map(
			function ( $group ) {
				return $group->to_array();
			},
			$groups
		);

		return rest_ensure_response( $data );
	}

	/**
	 * Get users with their group memberships
	 *
	 * @return \WP_REST_Response
	 */
	public function get_users_with_memberships() {
		// Get all users
		$users = get_users();

		// Get all groups
		$groups = Group::get_all( array( 'status' => 'active' ) );

		// Build user data with memberships
		$users_data = array();
		foreach ( $users as $user ) {
			$user_memberships = array();

			foreach ( $groups as $group ) {
				$membership                     = Membership::get_by_user_and_group( $user->ID, $group->id );
				$user_memberships[ $group->id ] = $membership && $membership->is_active();
			}

			$users_data[] = array(
				'id'          => $user->ID,
				'name'        => $user->display_name,
				'slug'        => $user->user_login,
				'memberships' => $user_memberships,
			);
		}

		return rest_ensure_response(
			array(
				'users'  => $users_data,
				'groups' => array_map(
					function ( $group ) {
						return $group->to_array();
					},
					$groups
				),
			)
		);
	}

	/**
	 * Update or create membership
	 *
	 * @param \WP_REST_Request $request Request object.
	 * @return \WP_REST_Response
	 */
	public function update_membership( $request ) {
		$user_id  = $request->get_param( 'user_id' );
		$group_id = $request->get_param( 'group_id' );
		$status   = $request->get_param( 'status' );

		if ( 'active' === $status ) {
			// Check if there's already an active membership
			$active_membership = Membership::get_active_by_user_and_group( $user_id, $group_id );

			if ( $active_membership ) {
				// Already active, nothing to do
				return rest_ensure_response(
					array(
						'success' => true,
						'message' => __( 'Membership is already active.', 'fair-membership' ),
					)
				);
			}

			// Create new active membership (keeps history)
			$membership             = new Membership();
			$membership->user_id    = $user_id;
			$membership->group_id   = $group_id;
			$membership->status     = 'active';
			$membership->started_at = current_time( 'mysql' );
		} else {
			// Deactivate membership
			$active_membership = Membership::get_active_by_user_and_group( $user_id, $group_id );

			if ( ! $active_membership ) {
				// Nothing to deactivate
				return rest_ensure_response(
					array(
						'success' => true,
						'message' => __( 'No active membership to deactivate.', 'fair-membership' ),
					)
				);
			}

			$membership = $active_membership;
			$membership->end();
		}

		// Validate before saving
		$validation_errors = $membership->validate();
		if ( ! empty( $validation_errors ) ) {
			return new \WP_Error(
				'membership_validation_failed',
				implode( ' ', $validation_errors ),
				array( 'status' => 400 )
			);
		}

		$result = $membership->save();

		if ( $result ) {
			return rest_ensure_response(
				array(
					'success' => true,
					'message' => __( 'Membership updated successfully.', 'fair-membership' ),
				)
			);
		} else {
			return new \WP_Error(
				'membership_save_failed',
				__( 'Failed to save membership.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}
	}
}
