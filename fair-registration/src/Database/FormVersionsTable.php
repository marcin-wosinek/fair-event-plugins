<?php
/**
 * Form versions table schema and operations
 *
 * @package FairRegistration
 */

namespace FairRegistration\Database;

defined( 'WPINC' ) || die;

/**
 * Manages the form versions table for storing complete form state objects
 */
class FormVersionsTable {

	/**
	 * Table name
	 *
	 * @var string
	 */
	private $table_name;

	/**
	 * Database version for this table
	 *
	 * @var string
	 */
	private $db_version = '1.0.0';

	/**
	 * Constructor
	 */
	public function __construct() {
		global $wpdb;
		$this->table_name = $wpdb->prefix . 'fair_registration_form_versions';
	}

	/**
	 * Get table name
	 *
	 * @return string
	 */
	public function get_table_name() {
		return $this->table_name;
	}

	/**
	 * Get database version
	 *
	 * @return string
	 */
	public function get_db_version() {
		return $this->db_version;
	}

	/**
	 * Create table
	 *
	 * @return void
	 */
	public function create_table() {
		global $wpdb;

		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$this->table_name} (
			id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			form_id varchar(255) NOT NULL,
			version_number varchar(50) NOT NULL,
			form_structure longtext NOT NULL,
			field_definitions longtext DEFAULT NULL,
			validation_rules longtext DEFAULT NULL,
			form_settings longtext DEFAULT NULL,
			post_content longtext DEFAULT NULL,
			created datetime DEFAULT CURRENT_TIMESTAMP,
			created_by bigint(20) UNSIGNED DEFAULT NULL,
			PRIMARY KEY (id),
			KEY form_id (form_id),
			KEY version_number (version_number),
			KEY created_by (created_by),
			KEY created (created),
			UNIQUE KEY form_version (form_id, version_number)
		) $charset_collate;";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		// Store database version
		update_option( 'fair_registration_form_versions_db_version', $this->db_version );
	}

	/**
	 * Insert a new form version
	 *
	 * @param array $version_data Version data.
	 * @return int|false Version ID on success, false on failure.
	 */
	public function insert_version( $version_data ) {
		global $wpdb;

		$defaults = array(
			'form_id'           => '',
			'version_number'    => '1.0.0',
			'form_structure'    => '',
			'field_definitions' => null,
			'validation_rules'  => null,
			'form_settings'     => null,
			'post_content'      => null,
			'created_by'        => get_current_user_id() ?: null,
		);

		$version_data = wp_parse_args( $version_data, $defaults );

		// Validate required fields
		if ( empty( $version_data['form_id'] ) || empty( $version_data['form_structure'] ) ) {
			return false;
		}

		// Ensure JSON fields are properly encoded
		$json_fields = array( 'form_structure', 'field_definitions', 'validation_rules', 'form_settings' );
		foreach ( $json_fields as $field ) {
			if ( isset( $version_data[ $field ] ) && ! is_null( $version_data[ $field ] ) ) {
				if ( is_array( $version_data[ $field ] ) || is_object( $version_data[ $field ] ) ) {
					$version_data[ $field ] = wp_json_encode( $version_data[ $field ] );
				}
			}
		}

		$result = $wpdb->insert(
			$this->table_name,
			array(
				'form_id'           => sanitize_text_field( $version_data['form_id'] ),
				'version_number'    => sanitize_text_field( $version_data['version_number'] ),
				'form_structure'    => $version_data['form_structure'],
				'field_definitions' => $version_data['field_definitions'],
				'validation_rules'  => $version_data['validation_rules'],
				'form_settings'     => $version_data['form_settings'],
				'post_content'      => $version_data['post_content'],
				'created_by'        => $version_data['created_by'] ? (int) $version_data['created_by'] : null,
			),
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d' )
		);

		return $result ? $wpdb->insert_id : false;
	}

	/**
	 * Get version by ID
	 *
	 * @param int $id Version database ID.
	 * @return array|null Version data or null if not found.
	 */
	public function get_version( $id ) {
		global $wpdb;

		$version = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$this->table_name} WHERE id = %d",
				$id
			),
			ARRAY_A
		);

		if ( $version ) {
			$version = $this->decode_json_fields( $version );
		}

		return $version ?: null;
	}

	/**
	 * Get versions by form ID
	 *
	 * @param string $form_id Form UUID.
	 * @param int    $limit Number of versions to return.
	 * @param int    $offset Offset for pagination.
	 * @return array Array of version data.
	 */
	public function get_versions_by_form_id( $form_id, $limit = 10, $offset = 0 ) {
		global $wpdb;

		$versions = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$this->table_name} WHERE form_id = %s ORDER BY created DESC LIMIT %d OFFSET %d",
				$form_id,
				$limit,
				$offset
			),
			ARRAY_A
		);

		if ( $versions ) {
			foreach ( $versions as &$version ) {
				$version = $this->decode_json_fields( $version );
			}
		}

		return $versions ?: array();
	}

	/**
	 * Get specific version by form ID and version number
	 *
	 * @param string $form_id Form UUID.
	 * @param string $version_number Version number.
	 * @return array|null Version data or null if not found.
	 */
	public function get_version_by_form_and_number( $form_id, $version_number ) {
		global $wpdb;

		$version = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$this->table_name} WHERE form_id = %s AND version_number = %s",
				$form_id,
				$version_number
			),
			ARRAY_A
		);

		if ( $version ) {
			$version = $this->decode_json_fields( $version );
		}

		return $version ?: null;
	}

	/**
	 * Get latest version for a form
	 *
	 * @param string $form_id Form UUID.
	 * @return array|null Latest version data or null if not found.
	 */
	public function get_latest_version( $form_id ) {
		global $wpdb;

		$version = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$this->table_name} WHERE form_id = %s ORDER BY created DESC LIMIT 1",
				$form_id
			),
			ARRAY_A
		);

		if ( $version ) {
			$version = $this->decode_json_fields( $version );
		}

		return $version ?: null;
	}

	/**
	 * Delete a version
	 *
	 * @param int $id Version database ID.
	 * @return bool True on success, false on failure.
	 */
	public function delete_version( $id ) {
		global $wpdb;

		$result = $wpdb->delete(
			$this->table_name,
			array( 'id' => (int) $id ),
			array( '%d' )
		);

		return $result !== false;
	}

	/**
	 * Delete all versions for a form
	 *
	 * @param string $form_id Form UUID.
	 * @return bool True on success, false on failure.
	 */
	public function delete_versions_by_form_id( $form_id ) {
		global $wpdb;

		$result = $wpdb->delete(
			$this->table_name,
			array( 'form_id' => sanitize_text_field( $form_id ) ),
			array( '%s' )
		);

		return $result !== false;
	}

	/**
	 * Count versions for a form
	 *
	 * @param string $form_id Form UUID.
	 * @return int Number of versions.
	 */
	public function count_versions( $form_id ) {
		global $wpdb;

		$count = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$this->table_name} WHERE form_id = %s",
				$form_id
			)
		);

		return (int) $count;
	}

	/**
	 * Generate next version number
	 *
	 * @param string $form_id Form UUID.
	 * @return string Next version number.
	 */
	public function get_next_version_number( $form_id ) {
		global $wpdb;

		$latest_version = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT version_number FROM {$this->table_name} WHERE form_id = %s ORDER BY created DESC LIMIT 1",
				$form_id
			)
		);

		if ( ! $latest_version ) {
			return '1.0.0';
		}

		// Simple version increment (increment patch version)
		$version_parts = explode( '.', $latest_version );
		if ( count( $version_parts ) === 3 ) {
			$version_parts[2] = (int) $version_parts[2] + 1;
			return implode( '.', $version_parts );
		}

		// Fallback if version format is unexpected
		return '1.0.0';
	}

	/**
	 * Decode JSON fields in version data
	 *
	 * @param array $version Version data array.
	 * @return array Version data with decoded JSON fields.
	 */
	private function decode_json_fields( $version ) {
		$json_fields = array( 'form_structure', 'field_definitions', 'validation_rules', 'form_settings' );

		foreach ( $json_fields as $field ) {
			if ( isset( $version[ $field ] ) && ! is_null( $version[ $field ] ) ) {
				$decoded = json_decode( $version[ $field ], true );
				if ( json_last_error() === JSON_ERROR_NONE ) {
					$version[ $field ] = $decoded;
				}
			}
		}

		return $version;
	}
}