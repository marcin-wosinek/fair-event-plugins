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

		// Upload CSV for import
		register_rest_route(
			self::NAMESPACE,
			'/import-users/upload',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'upload_import_csv' ),
				'permission_callback' => array( $this, 'check_permission' ),
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

	/**
	 * Upload and parse CSV file for import
	 *
	 * @param \WP_REST_Request $request Request object.
	 * @return \WP_REST_Response
	 */
	public function upload_import_csv( $request ) {
		$files = $request->get_file_params();

		if ( empty( $files['file'] ) ) {
			return new \WP_Error(
				'no_file',
				__( 'No file uploaded.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		$file = $files['file'];

		// Validate file type
		$file_type = wp_check_filetype( $file['name'] );
		if ( 'csv' !== $file_type['ext'] && 'text/csv' !== $file['type'] ) {
			return new \WP_Error(
				'invalid_file_type',
				__( 'Please upload a CSV file.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		// Validate file size (10MB max)
		$max_size = 10 * 1024 * 1024;
		if ( $file['size'] > $max_size ) {
			return new \WP_Error(
				'file_too_large',
				__( 'File size must be less than 10MB.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		// Parse CSV
		$csv_data = $this->parse_csv( $file['tmp_name'] );

		if ( is_wp_error( $csv_data ) ) {
			return $csv_data;
		}

		// Validate row count (500 max)
		if ( count( $csv_data ) > 500 ) {
			return new \WP_Error(
				'too_many_rows',
				__( 'CSV file contains too many rows. Maximum is 500 rows.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		// Get columns from first row
		$columns = ! empty( $csv_data ) ? array_keys( $csv_data[0] ) : array();

		// Get preview (first 5 rows)
		$preview_rows = array_slice( $csv_data, 0, 5 );

		return rest_ensure_response(
			array(
				'success' => true,
				'data'    => array(
					'rows'    => $csv_data,
					'columns' => $columns,
					'preview' => array(
						'columns' => $columns,
						'rows'    => $preview_rows,
						'total'   => count( $csv_data ),
					),
				),
			)
		);
	}

	/**
	 * Parse CSV file into array
	 *
	 * @param string $file_path Path to CSV file.
	 * @return array|\WP_Error Array of rows or error.
	 */
	private function parse_csv( $file_path ) {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$content = file_get_contents( $file_path );

		if ( false === $content ) {
			return new \WP_Error(
				'read_error',
				__( 'Failed to read CSV file.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}

		$lines = str_getcsv( $content, "\n" );
		if ( empty( $lines ) ) {
			return new \WP_Error(
				'empty_file',
				__( 'CSV file is empty.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		// Get headers from first line
		$headers = str_getcsv( array_shift( $lines ) );
		$headers = array_map( 'trim', $headers );

		if ( empty( $headers ) ) {
			return new \WP_Error(
				'no_headers',
				__( 'CSV file has no headers.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		// Parse data rows
		$data = array();
		foreach ( $lines as $line ) {
			if ( empty( trim( $line ) ) ) {
				continue;
			}

			$row = str_getcsv( $line );
			$row = array_map( 'trim', $row );

			// Ensure row has same number of columns as headers
			if ( count( $row ) !== count( $headers ) ) {
				continue;
			}

			$data[] = array_combine( $headers, $row );
		}

		if ( empty( $data ) ) {
			return new \WP_Error(
				'no_data',
				__( 'CSV file contains no valid data rows.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		return $data;
	}
}
