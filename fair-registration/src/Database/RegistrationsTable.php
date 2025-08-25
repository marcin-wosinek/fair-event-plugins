<?php
/**
 * Database table management for registrations
 *
 * @package FairRegistration
 */

namespace FairRegistration\Database;

defined( 'WPINC' ) || die;

/**
 * Manages the registrations custom table
 */
class RegistrationsTable {

	/**
	 * Table name
	 *
	 * @var string
	 */
	private $table_name;

	/**
	 * Database version
	 *
	 * @var string
	 */
	private $db_version = '1.0.2';

	/**
	 * Constructor
	 */
	public function __construct() {
		global $wpdb;
		$this->table_name = $wpdb->prefix . 'fair_registrations';
	}

	/**
	 * Get table name
	 *
	 * @return string Table name
	 */
	public function get_table_name() {
		return $this->table_name;
	}

	/**
	 * Create the registrations table
	 *
	 * @return void
	 */
	public function create_table() {
		global $wpdb;

		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$this->table_name} (
			id bigint(20) NOT NULL AUTO_INCREMENT,
			user_id bigint(20) NULL DEFAULT NULL,
			created datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
			modified datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			url text NOT NULL,
			form_id bigint(20) NOT NULL,
			registration_data longtext NOT NULL,
			PRIMARY KEY (id),
			KEY form_id (form_id),
			KEY user_id (user_id),
			KEY created (created)
		) $charset_collate;";

		require_once( ABSPATH . 'wp-admin/includes/upgrade.php' );
		dbDelta( $sql );

		// Store the database version
		update_option( 'fair_registration_db_version', $this->db_version );
	}

	/**
	 * Drop the registrations table
	 *
	 * @return void
	 */
	public function drop_table() {
		global $wpdb;
		$wpdb->query( "DROP TABLE IF EXISTS {$this->table_name}" );
		delete_option( 'fair_registration_db_version' );
	}

	/**
	 * Check if table needs to be created or updated
	 *
	 * @return bool True if table needs update
	 */
	public function needs_update() {
		$installed_version = get_option( 'fair_registration_db_version', '0.0.0' );
		return version_compare( $installed_version, $this->db_version, '<' );
	}

	/**
	 * Insert a new registration
	 *
	 * @param array $data Registration data.
	 * @return int|false Registration ID on success, false on failure
	 */
	public function insert_registration( $data ) {
		global $wpdb;

		$defaults = array(
			'user_id' => get_current_user_id() ?: null,
			'created' => current_time( 'mysql' ),
			'modified' => current_time( 'mysql' ),
			'url' => '',
			'form_id' => 0,
			'registration_data' => ''
		);

		$data = wp_parse_args( $data, $defaults );

		// Ensure registration_data is JSON
		if ( is_array( $data['registration_data'] ) ) {
			$data['registration_data'] = wp_json_encode( $data['registration_data'] );
		}

		$result = $wpdb->insert(
			$this->table_name,
			$data,
			array(
				'%d', // user_id
				'%s', // created
				'%s', // modified
				'%s', // url
				'%d', // form_id
				'%s'  // registration_data
			)
		);

		if ( $result === false ) {
			return false;
		}

		return $wpdb->insert_id;
	}

	/**
	 * Get registrations by form ID
	 *
	 * @param int $form_id Form ID.
	 * @param int $limit Limit results.
	 * @param int $offset Offset for pagination.
	 * @return array Array of registrations
	 */
	public function get_registrations_by_form( $form_id, $limit = 100, $offset = 0 ) {
		global $wpdb;

		$sql = $wpdb->prepare(
			"SELECT * FROM {$this->table_name} 
			WHERE form_id = %d 
			ORDER BY created DESC 
			LIMIT %d OFFSET %d",
			$form_id,
			$limit,
			$offset
		);

		$results = $wpdb->get_results( $sql, ARRAY_A );

		// Decode JSON data
		foreach ( $results as &$result ) {
			$result['registration_data'] = json_decode( $result['registration_data'], true );
		}

		return $results;
	}

	/**
	 * Get all registrations
	 *
	 * @param int $limit Limit results.
	 * @param int $offset Offset for pagination.
	 * @return array Array of registrations
	 */
	public function get_all_registrations( $limit = 100, $offset = 0 ) {
		global $wpdb;

		$sql = $wpdb->prepare(
			"SELECT * FROM {$this->table_name} 
			ORDER BY created DESC 
			LIMIT %d OFFSET %d",
			$limit,
			$offset
		);

		$results = $wpdb->get_results( $sql, ARRAY_A );

		// Decode JSON data
		foreach ( $results as &$result ) {
			$result['registration_data'] = json_decode( $result['registration_data'], true );
		}

		return $results;
	}

	/**
	 * Get registration by ID
	 *
	 * @param int $id Registration ID.
	 * @return array|null Registration data or null if not found
	 */
	public function get_registration( $id ) {
		global $wpdb;

		$sql = $wpdb->prepare(
			"SELECT * FROM {$this->table_name} WHERE id = %d",
			$id
		);

		$result = $wpdb->get_row( $sql, ARRAY_A );

		if ( $result ) {
			$result['registration_data'] = json_decode( $result['registration_data'], true );
		}

		return $result;
	}

	/**
	 * Update registration
	 *
	 * @param int   $id Registration ID.
	 * @param array $data Data to update.
	 * @return bool True on success, false on failure
	 */
	public function update_registration( $id, $data ) {
		global $wpdb;

		// Always update modified time
		$data['modified'] = current_time( 'mysql' );

		// Ensure registration_data is JSON if it's an array
		if ( isset( $data['registration_data'] ) && is_array( $data['registration_data'] ) ) {
			$data['registration_data'] = wp_json_encode( $data['registration_data'] );
		}

		$result = $wpdb->update(
			$this->table_name,
			$data,
			array( 'id' => $id ),
			null,
			array( '%d' )
		);

		return $result !== false;
	}

	/**
	 * Delete registration
	 *
	 * @param int $id Registration ID.
	 * @return bool True on success, false on failure
	 */
	public function delete_registration( $id ) {
		global $wpdb;

		$result = $wpdb->delete(
			$this->table_name,
			array( 'id' => $id ),
			array( '%d' )
		);

		return $result !== false;
	}

	/**
	 * Count registrations by form ID
	 *
	 * @param int $form_id Form ID.
	 * @return int Registration count
	 */
	public function count_registrations_by_form( $form_id ) {
		global $wpdb;

		$sql = $wpdb->prepare(
			"SELECT COUNT(*) FROM {$this->table_name} WHERE form_id = %d",
			$form_id
		);

		return (int) $wpdb->get_var( $sql );
	}

	/**
	 * Count total registrations
	 *
	 * @return int Total registration count
	 */
	public function count_total_registrations() {
		global $wpdb;

		$sql = "SELECT COUNT(*) FROM {$this->table_name}";

		return (int) $wpdb->get_var( $sql );
	}

}