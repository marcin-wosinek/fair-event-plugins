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

		// Validate users for import
		register_rest_route(
			self::NAMESPACE,
			'/import-users/validate',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'validate_import_users' ),
				'permission_callback' => array( $this, 'check_permission' ),
				'args'                => array(
					'users' => array(
						'required' => true,
						'type'     => 'array',
					),
				),
			)
		);

		// Execute user import
		register_rest_route(
			self::NAMESPACE,
			'/import-users/execute',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'execute_import_users' ),
				'permission_callback' => array( $this, 'check_permission' ),
				'args'                => array(
					'users'     => array(
						'required' => true,
						'type'     => 'array',
					),
					'group_ids' => array(
						'required' => false,
						'type'     => 'array',
						'default'  => array(),
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

	/**
	 * Validate users for import
	 *
	 * @param \WP_REST_Request $request Request object.
	 * @return \WP_REST_Response
	 */
	public function validate_import_users( $request ) {
		$users = $request->get_param( 'users' );

		$validation_errors = array();
		$existing_users    = array();

		foreach ( $users as $index => $user ) {
			$errors = array();

			// Validate required fields
			if ( empty( $user['user_login'] ) ) {
				$errors[] = __( 'Username is required', 'fair-membership' );
			}

			if ( empty( $user['user_email'] ) ) {
				$errors[] = __( 'Email is required', 'fair-membership' );
			}

			// Validate username format
			if ( ! empty( $user['user_login'] ) ) {
				// Use WordPress's sanitize_user to check if username is valid
				$sanitized = sanitize_user( $user['user_login'], true );
				if ( $sanitized !== $user['user_login'] ) {
					$errors[] = __( 'Username contains invalid characters', 'fair-membership' );
				}

				// Check username length (WordPress allows 3-60 characters)
				$username_length = strlen( $user['user_login'] );
				if ( $username_length < 3 || $username_length > 60 ) {
					$errors[] = __( 'Username must be between 3 and 60 characters', 'fair-membership' );
				}

				// Check if username exists
				$existing_user = get_user_by( 'login', $user['user_login'] );
				if ( $existing_user ) {
					$existing_users[ $index ] = $existing_user->ID;
				}
			}

			// Validate email format
			if ( ! empty( $user['user_email'] ) ) {
				if ( ! is_email( $user['user_email'] ) ) {
					$errors[] = __( 'Invalid email format', 'fair-membership' );
				}

				// Check if email exists
				if ( ! isset( $existing_users[ $index ] ) ) {
					$existing_by_email = get_user_by( 'email', $user['user_email'] );
					if ( $existing_by_email ) {
						$existing_users[ $index ] = $existing_by_email->ID;
					}
				}
			}

			// Validate URL if provided
			if ( ! empty( $user['user_url'] ) && ! filter_var( $user['user_url'], FILTER_VALIDATE_URL ) ) {
				$errors[] = __( 'Invalid website URL', 'fair-membership' );
			}

			if ( ! empty( $errors ) ) {
				$validation_errors[ $index ] = $errors;
			}
		}

		// Check for duplicate usernames within the CSV
		$usernames       = array_column( $users, 'user_login' );
		$username_counts = array_count_values( array_filter( $usernames ) );
		foreach ( $username_counts as $username => $count ) {
			if ( $count > 1 ) {
				// Find all rows with this username
				foreach ( $users as $index => $user ) {
					if ( $user['user_login'] === $username ) {
						if ( ! isset( $validation_errors[ $index ] ) ) {
							$validation_errors[ $index ] = array();
						}
						$validation_errors[ $index ][] = __( 'Duplicate username in CSV', 'fair-membership' );
					}
				}
			}
		}

		// Check for duplicate emails within the CSV
		$emails       = array_column( $users, 'user_email' );
		$email_counts = array_count_values( array_filter( $emails ) );
		foreach ( $email_counts as $email => $count ) {
			if ( $count > 1 ) {
				// Find all rows with this email
				foreach ( $users as $index => $user ) {
					if ( $user['user_email'] === $email ) {
						if ( ! isset( $validation_errors[ $index ] ) ) {
							$validation_errors[ $index ] = array();
						}
						$validation_errors[ $index ][] = __( 'Duplicate email in CSV', 'fair-membership' );
					}
				}
			}
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'data'    => array(
					'validation'     => $validation_errors,
					'existing_users' => $existing_users,
				),
			)
		);
	}

	/**
	 * Execute user import
	 *
	 * @param \WP_REST_Request $request Request object.
	 * @return \WP_REST_Response
	 */
	public function execute_import_users( $request ) {
		$users     = $request->get_param( 'users' );
		$group_ids = $request->get_param( 'group_ids' );

		$results = array(
			'created' => 0,
			'updated' => 0,
			'skipped' => 0,
			'errors'  => array(),
		);

		foreach ( $users as $index => $user ) {
			$action = isset( $user['action'] ) ? $user['action'] : 'skip';

			if ( 'skip' === $action ) {
				++$results['skipped'];
				continue;
			}

			try {
				if ( 'create' === $action ) {
					// Create new user
					$user_data = array(
						'user_login' => $user['user_login'],
						'user_email' => $user['user_email'],
						'user_pass'  => wp_generate_password(),
					);

					// Add optional fields
					if ( ! empty( $user['display_name'] ) ) {
						$user_data['display_name'] = $user['display_name'];
					}
					if ( ! empty( $user['first_name'] ) ) {
						$user_data['first_name'] = $user['first_name'];
					}
					if ( ! empty( $user['last_name'] ) ) {
						$user_data['last_name'] = $user['last_name'];
					}
					if ( ! empty( $user['user_url'] ) ) {
						$user_data['user_url'] = $user['user_url'];
					}
					if ( ! empty( $user['description'] ) ) {
						$user_data['description'] = $user['description'];
					}

					$user_id = wp_insert_user( $user_data );

					if ( is_wp_error( $user_id ) ) {
						$results['errors'][] = array(
							'row'     => $index + 1,
							'message' => $user_id->get_error_message(),
						);
						continue;
					}

					++$results['created'];

					// Assign groups
					if ( ! empty( $group_ids ) ) {
						$this->assign_user_groups( $user_id, $group_ids );
					}
				} elseif ( 'update' === $action ) {
					// Update existing user
					$existing_user = get_user_by( 'login', $user['user_login'] );
					if ( ! $existing_user ) {
						$existing_user = get_user_by( 'email', $user['user_email'] );
					}

					if ( ! $existing_user ) {
						$results['errors'][] = array(
							'row'     => $index + 1,
							'message' => __( 'User not found for update', 'fair-membership' ),
						);
						continue;
					}

					$user_data = array(
						'ID' => $existing_user->ID,
					);

					// Update fields
					if ( ! empty( $user['user_email'] ) && $user['user_email'] !== $existing_user->user_email ) {
						$user_data['user_email'] = $user['user_email'];
					}
					if ( ! empty( $user['display_name'] ) ) {
						$user_data['display_name'] = $user['display_name'];
					}
					if ( ! empty( $user['first_name'] ) ) {
						$user_data['first_name'] = $user['first_name'];
					}
					if ( ! empty( $user['last_name'] ) ) {
						$user_data['last_name'] = $user['last_name'];
					}
					if ( ! empty( $user['user_url'] ) ) {
						$user_data['user_url'] = $user['user_url'];
					}
					if ( ! empty( $user['description'] ) ) {
						$user_data['description'] = $user['description'];
					}

					$user_id = wp_update_user( $user_data );

					if ( is_wp_error( $user_id ) ) {
						$results['errors'][] = array(
							'row'     => $index + 1,
							'message' => $user_id->get_error_message(),
						);
						continue;
					}

					++$results['updated'];

					// Assign groups
					if ( ! empty( $group_ids ) ) {
						$this->assign_user_groups( $existing_user->ID, $group_ids );
					}
				}
			} catch ( \Exception $e ) {
				$results['errors'][] = array(
					'row'     => $index + 1,
					'message' => $e->getMessage(),
				);
			}
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'data'    => array(
					'results' => $results,
				),
			)
		);
	}

	/**
	 * Assign groups to a user
	 *
	 * @param int   $user_id User ID.
	 * @param array $group_ids Array of group IDs.
	 * @return void
	 */
	private function assign_user_groups( $user_id, $group_ids ) {
		foreach ( $group_ids as $group_id ) {
			// Check if active membership already exists
			$existing_membership = Membership::get_active_by_user_and_group( $user_id, $group_id );

			if ( $existing_membership ) {
				continue;
			}

			// Create new membership
			$membership             = new Membership();
			$membership->user_id    = $user_id;
			$membership->group_id   = $group_id;
			$membership->status     = 'active';
			$membership->started_at = current_time( 'mysql' );
			$membership->save();
		}
	}
}
