<?php
/**
 * REST API for Fair User Import
 *
 * @package FairUserImport
 */

namespace FairUserImport\API;

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
	protected $namespace = 'fair-user-import/v1';

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
		// Upload CSV for import
		register_rest_route(
			$this->namespace,
			'/import-users/upload',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'upload_import_csv' ),
					'permission_callback' => array( $this, 'check_permission' ),
				),
			)
		);

		// Validate users for import
		register_rest_route(
			$this->namespace,
			'/import-users/validate',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'validate_import_users' ),
					'permission_callback' => array( $this, 'check_permission' ),
					'args'                => array(
						'users' => array(
							'required' => true,
							'type'     => 'array',
						),
					),
				),
			)
		);

		// Execute user import
		register_rest_route(
			$this->namespace,
			'/import-users/execute',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
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
				__( 'No file uploaded.', 'fair-user-import' ),
				array( 'status' => 400 )
			);
		}

		$file = $files['file'];

		// Validate file type
		$file_type = wp_check_filetype( $file['name'] );
		if ( 'csv' !== $file_type['ext'] && 'text/csv' !== $file['type'] ) {
			return new \WP_Error(
				'invalid_file_type',
				__( 'Please upload a CSV file.', 'fair-user-import' ),
				array( 'status' => 400 )
			);
		}

		// Validate file size (10MB max)
		$max_size = 10 * 1024 * 1024;
		if ( $file['size'] > $max_size ) {
			return new \WP_Error(
				'file_too_large',
				__( 'File size must be less than 10MB.', 'fair-user-import' ),
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
				__( 'CSV file contains too many rows. Maximum is 500 rows.', 'fair-user-import' ),
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
				__( 'Failed to read CSV file.', 'fair-user-import' ),
				array( 'status' => 500 )
			);
		}

		$lines = str_getcsv( $content, "\n" );
		if ( empty( $lines ) ) {
			return new \WP_Error(
				'empty_file',
				__( 'CSV file is empty.', 'fair-user-import' ),
				array( 'status' => 400 )
			);
		}

		// Get headers from first line
		$headers = str_getcsv( array_shift( $lines ) );
		$headers = array_map( 'trim', $headers );

		if ( empty( $headers ) ) {
			return new \WP_Error(
				'no_headers',
				__( 'CSV file has no headers.', 'fair-user-import' ),
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
				__( 'CSV file contains no valid data rows.', 'fair-user-import' ),
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
				$errors[] = __( 'Username is required', 'fair-user-import' );
			}

			if ( empty( $user['user_email'] ) ) {
				$errors[] = __( 'Email is required', 'fair-user-import' );
			}

			// Validate username format
			if ( ! empty( $user['user_login'] ) ) {
				// Use WordPress's sanitize_user to check if username is valid
				$sanitized = sanitize_user( $user['user_login'], true );
				if ( $sanitized !== $user['user_login'] ) {
					$errors[] = __( 'Username contains invalid characters', 'fair-user-import' );
				}

				// Check username length (WordPress allows 3-60 characters)
				$username_length = strlen( $user['user_login'] );
				if ( $username_length < 3 || $username_length > 60 ) {
					$errors[] = __( 'Username must be between 3 and 60 characters', 'fair-user-import' );
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
					$errors[] = __( 'Invalid email format', 'fair-user-import' );
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
				$errors[] = __( 'Invalid website URL', 'fair-user-import' );
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
						$validation_errors[ $index ][] = __( 'Duplicate username in CSV', 'fair-user-import' );
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
						$validation_errors[ $index ][] = __( 'Duplicate email in CSV', 'fair-user-import' );
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

					// Assign groups if Fair Membership is available
					if ( ! empty( $group_ids ) && $this->has_fair_membership() ) {
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
							'message' => __( 'User not found for update', 'fair-user-import' ),
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

					// Assign groups if Fair Membership is available
					if ( ! empty( $group_ids ) && $this->has_fair_membership() ) {
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
	 * Check if Fair Membership plugin is available
	 *
	 * @return bool
	 */
	private function has_fair_membership() {
		return class_exists( 'FairMembership\Models\Membership' ) && class_exists( 'FairMembership\Models\Group' );
	}

	/**
	 * Assign groups to a user (requires Fair Membership plugin)
	 *
	 * @param int   $user_id User ID.
	 * @param array $group_ids Array of group IDs.
	 * @return void
	 */
	private function assign_user_groups( $user_id, $group_ids ) {
		if ( ! $this->has_fair_membership() ) {
			return;
		}

		foreach ( $group_ids as $group_id ) {
			// Check if active membership already exists
			$existing_membership = \FairMembership\Models\Membership::get_active_by_user_and_group( $user_id, $group_id );

			if ( $existing_membership ) {
				continue;
			}

			// Create new membership
			$membership             = new \FairMembership\Models\Membership();
			$membership->user_id    = $user_id;
			$membership->group_id   = $group_id;
			$membership->status     = 'active';
			$membership->started_at = current_time( 'mysql' );
			$membership->save();
		}
	}
}
