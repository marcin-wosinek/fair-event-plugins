<?php
/**
 * Database manager for Fair Registration
 *
 * @package FairRegistration
 */

namespace FairRegistration\Database;

use FairRegistration\Database\RegistrationsTable;

defined( 'WPINC' ) || die;

/**
 * Manages database operations for the plugin
 */
class DatabaseManager {

	/**
	 * Registrations table instance
	 *
	 * @var RegistrationsTable
	 */
	private $registrations_table;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->registrations_table = new RegistrationsTable();
	}

	/**
	 * Initialize database - create tables if needed
	 *
	 * @return void
	 */
	public function init() {
		if ( $this->registrations_table->needs_update() ) {
			$this->registrations_table->create_table();
		}
	}

	/**
	 * Create all database tables
	 *
	 * @return void
	 */
	public function create_tables() {
		$this->registrations_table->create_table();
	}

	/**
	 * Drop all database tables
	 *
	 * @return void
	 */
	public function drop_tables() {
		$this->registrations_table->drop_table();
	}

	/**
	 * Get registrations table instance
	 *
	 * @return RegistrationsTable
	 */
	public function get_registrations_table() {
		return $this->registrations_table;
	}

	/**
	 * Insert a new registration
	 *
	 * @param array $data Registration data.
	 * @return int|false Registration ID on success, false on failure
	 */
	public function insert_registration( $data ) {
		return $this->registrations_table->insert_registration( $data );
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
		return $this->registrations_table->get_registrations_by_form( $form_id, $limit, $offset );
	}

	/**
	 * Get all registrations
	 *
	 * @param int $limit Limit results.
	 * @param int $offset Offset for pagination.
	 * @return array Array of registrations
	 */
	public function get_all_registrations( $limit = 100, $offset = 0 ) {
		return $this->registrations_table->get_all_registrations( $limit, $offset );
	}

	/**
	 * Get registration by ID
	 *
	 * @param int $id Registration ID.
	 * @return array|null Registration data or null if not found
	 */
	public function get_registration( $id ) {
		return $this->registrations_table->get_registration( $id );
	}

	/**
	 * Update registration
	 *
	 * @param int   $id Registration ID.
	 * @param array $data Data to update.
	 * @return bool True on success, false on failure
	 */
	public function update_registration( $id, $data ) {
		return $this->registrations_table->update_registration( $id, $data );
	}

	/**
	 * Delete registration
	 *
	 * @param int $id Registration ID.
	 * @return bool True on success, false on failure
	 */
	public function delete_registration( $id ) {
		return $this->registrations_table->delete_registration( $id );
	}

	/**
	 * Count registrations by form ID
	 *
	 * @param int $form_id Form ID.
	 * @return int Registration count
	 */
	public function count_registrations_by_form( $form_id ) {
		return $this->registrations_table->count_registrations_by_form( $form_id );
	}

	/**
	 * Count total registrations
	 *
	 * @return int Total registration count
	 */
	public function count_total_registrations() {
		return $this->registrations_table->count_total_registrations();
	}

	/**
	 * Get forms that have registrations
	 *
	 * @return array Array of form IDs with registration counts
	 */
	public function get_forms_with_registrations() {
		global $wpdb;
		
		$table_name = $this->registrations_table->get_table_name();
		
		$sql = "SELECT form_id, COUNT(*) as count 
				FROM {$table_name} 
				GROUP BY form_id 
				ORDER BY count DESC";
		
		return $wpdb->get_results( $sql, ARRAY_A );
	}

	/**
	 * Get registration statistics
	 *
	 * @return array Statistics array
	 */
	public function get_statistics() {
		global $wpdb;
		
		$table_name = $this->registrations_table->get_table_name();
		
		$stats = array();
		
		// Total registrations
		$stats['total'] = $this->count_total_registrations();
		
		// Recent registrations (last 30 days)
		$sql = $wpdb->prepare(
			"SELECT COUNT(*) as count 
			FROM {$table_name} 
			WHERE created >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
		);
		$stats['recent'] = (int) $wpdb->get_var( $sql );
		
		// Registrations per form
		$stats['by_form'] = $this->get_forms_with_registrations();
		
		return $stats;
	}
}