<?php
/**
 * REST API for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\API;

use FairMembership\Models\Group;
use FairMembership\Models\Membership;

defined( 'WPINC' ) || die;

/**
 * REST API class
 */
class RestAPI {

	/**
	 * API namespace
	 */
	const NAMESPACE = 'fair-membership/v1';

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
			self::NAMESPACE,
			'/groups',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_groups' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Get users with memberships
		register_rest_route(
			self::NAMESPACE,
			'/users-with-memberships',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_users_with_memberships' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Update membership
		register_rest_route(
			self::NAMESPACE,
			'/membership',
			array(
				'methods'             => 'POST',
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

		// Check if membership exists
		$membership = Membership::get_by_user_and_group( $user_id, $group_id );

		if ( 'active' === $status ) {
			// Create or activate membership
			if ( ! $membership ) {
				$membership           = new Membership();
				$membership->user_id  = $user_id;
				$membership->group_id = $group_id;
				$membership->status   = 'active';
			} else {
				$membership->status   = 'active';
				$membership->ended_at = null;
			}
		} else {
			// Deactivate membership
			if ( $membership ) {
				$membership->end();
			} else {
				// Nothing to deactivate
				return rest_ensure_response(
					array(
						'success' => true,
						'message' => __( 'No membership to deactivate.', 'fair-membership' ),
					)
				);
			}
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
