<?php
/**
 * Forms table schema and operations
 *
 * @package FairRegistration
 */

namespace FairRegistration\Database;

defined( 'WPINC' ) || die;

/**
 * Manages the registration forms table
 */
class FormsTable {

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
		$this->table_name = $wpdb->prefix . 'fair_registration_forms';
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
			post_id bigint(20) UNSIGNED DEFAULT NULL,
			form_name varchar(255) DEFAULT NULL,
			current_version_id bigint(20) UNSIGNED DEFAULT NULL,
			status varchar(20) DEFAULT 'active',
			created datetime DEFAULT CURRENT_TIMESTAMP,
			modified datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY form_id (form_id),
			KEY post_id (post_id),
			KEY current_version_id (current_version_id),
			KEY status (status)
		) $charset_collate;";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		// Store database version
		update_option( 'fair_registration_forms_db_version', $this->db_version );
	}

	/**
	 * Insert a new form
	 *
	 * @param array $form_data Form data.
	 * @return int|false Form ID on success, false on failure.
	 */
	public function insert_form( $form_data ) {
		global $wpdb;

		$defaults = array(
			'form_id'            => '',
			'post_id'            => null,
			'form_name'          => null,
			'current_version_id' => null,
			'status'             => 'active',
		);

		$form_data = wp_parse_args( $form_data, $defaults );

		// Validate required fields
		if ( empty( $form_data['form_id'] ) ) {
			return false;
		}

		$result = $wpdb->insert(
			$this->table_name,
			array(
				'form_id'            => sanitize_text_field( $form_data['form_id'] ),
				'post_id'            => $form_data['post_id'] ? (int) $form_data['post_id'] : null,
				'form_name'          => $form_data['form_name'] ? sanitize_text_field( $form_data['form_name'] ) : null,
				'current_version_id' => $form_data['current_version_id'] ? (int) $form_data['current_version_id'] : null,
				'status'             => sanitize_text_field( $form_data['status'] ),
			),
			array( '%s', '%d', '%s', '%d', '%s' )
		);

		return $result ? $wpdb->insert_id : false;
	}

	/**
	 * Update a form
	 *
	 * @param int   $id Form database ID.
	 * @param array $form_data Form data to update.
	 * @return bool True on success, false on failure.
	 */
	public function update_form( $id, $form_data ) {
		global $wpdb;

		$allowed_fields = array(
			'post_id'            => '%d',
			'form_name'          => '%s',
			'current_version_id' => '%d',
			'status'             => '%s',
		);

		$update_data = array();
		$format      = array();

		foreach ( $form_data as $field => $value ) {
			if ( isset( $allowed_fields[ $field ] ) ) {
				if ( $field === 'post_id' || $field === 'current_version_id' ) {
					$update_data[ $field ] = $value ? (int) $value : null;
				} else {
					$update_data[ $field ] = sanitize_text_field( $value );
				}
				$format[] = $allowed_fields[ $field ];
			}
		}

		if ( empty( $update_data ) ) {
			return false;
		}

		$result = $wpdb->update(
			$this->table_name,
			$update_data,
			array( 'id' => (int) $id ),
			$format,
			array( '%d' )
		);

		return $result !== false;
	}

	/**
	 * Get form by ID
	 *
	 * @param int $id Form database ID.
	 * @return array|null Form data or null if not found.
	 */
	public function get_form( $id ) {
		global $wpdb;

		$form = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$this->table_name} WHERE id = %d",
				$id
			),
			ARRAY_A
		);

		return $form ?: null;
	}

	/**
	 * Get form by form ID
	 *
	 * @param string $form_id Form UUID.
	 * @return array|null Form data or null if not found.
	 */
	public function get_form_by_form_id( $form_id ) {
		global $wpdb;

		$form = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$this->table_name} WHERE form_id = %s",
				$form_id
			),
			ARRAY_A
		);

		return $form ?: null;
	}

	/**
	 * Get forms by post ID
	 *
	 * @param int $post_id WordPress post ID.
	 * @return array Array of form data.
	 */
	public function get_forms_by_post_id( $post_id ) {
		global $wpdb;

		$forms = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$this->table_name} WHERE post_id = %d ORDER BY created DESC",
				$post_id
			),
			ARRAY_A
		);

		return $forms ?: array();
	}

	/**
	 * Get all forms
	 *
	 * @param int $limit Number of forms to return.
	 * @param int $offset Offset for pagination.
	 * @return array Array of form data.
	 */
	public function get_all_forms( $limit = 20, $offset = 0 ) {
		global $wpdb;

		$forms = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$this->table_name} ORDER BY created DESC LIMIT %d OFFSET %d",
				$limit,
				$offset
			),
			ARRAY_A
		);

		return $forms ?: array();
	}

	/**
	 * Delete a form
	 *
	 * @param int $id Form database ID.
	 * @return bool True on success, false on failure.
	 */
	public function delete_form( $id ) {
		global $wpdb;

		$result = $wpdb->delete(
			$this->table_name,
			array( 'id' => (int) $id ),
			array( '%d' )
		);

		return $result !== false;
	}

	/**
	 * Count forms
	 *
	 * @return int Number of forms.
	 */
	public function count_forms() {
		global $wpdb;

		$count = $wpdb->get_var(
			"SELECT COUNT(*) FROM {$this->table_name}"
		);

		return (int) $count;
	}
}