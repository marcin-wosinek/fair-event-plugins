<?php
/**
 * Database manager for Fair Registration
 *
 * @package FairRegistration
 */

namespace FairRegistration\Database;

use FairRegistration\Database\RegistrationsTable;
use FairRegistration\Database\FormsTable;
use FairRegistration\Database\FormVersionsTable;

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
	 * Forms table instance
	 *
	 * @var FormsTable
	 */
	private $forms_table;

	/**
	 * Form versions table instance
	 *
	 * @var FormVersionsTable
	 */
	private $form_versions_table;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->registrations_table   = new RegistrationsTable();
		$this->forms_table          = new FormsTable();
		$this->form_versions_table  = new FormVersionsTable();
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
		$this->forms_table->create_table();
		$this->form_versions_table->create_table();
	}

	/**
	 * Create all database tables
	 *
	 * @return void
	 */
	public function create_tables() {
		$this->registrations_table->create_table();
		$this->forms_table->create_table();
		$this->form_versions_table->create_table();
	}

	/**
	 * Drop all database tables
	 *
	 * @return void
	 */
	public function drop_tables() {
		$this->registrations_table->drop_table();
		// Note: Forms and versions tables are not dropped by default
		// to preserve form structure data
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
	 * Get forms table instance
	 *
	 * @return FormsTable
	 */
	public function get_forms_table() {
		return $this->forms_table;
	}

	/**
	 * Get form versions table instance
	 *
	 * @return FormVersionsTable
	 */
	public function get_form_versions_table() {
		return $this->form_versions_table;
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

	// Forms table convenience methods

	/**
	 * Insert a new form
	 *
	 * @param array $form_data Form data.
	 * @return int|false Form ID on success, false on failure.
	 */
	public function insert_form( $form_data ) {
		return $this->forms_table->insert_form( $form_data );
	}

	/**
	 * Get form by form ID
	 *
	 * @param string $form_id Form UUID.
	 * @return array|null Form data or null if not found.
	 */
	public function get_form_by_form_id( $form_id ) {
		return $this->forms_table->get_form_by_form_id( $form_id );
	}

	/**
	 * Update form
	 *
	 * @param int   $id Form database ID.
	 * @param array $form_data Form data to update.
	 * @return bool True on success, false on failure.
	 */
	public function update_form( $id, $form_data ) {
		return $this->forms_table->update_form( $id, $form_data );
	}

	// Form versions table convenience methods

	/**
	 * Insert a new form version
	 *
	 * @param array $version_data Version data.
	 * @return int|false Version ID on success, false on failure.
	 */
	public function insert_form_version( $version_data ) {
		return $this->form_versions_table->insert_version( $version_data );
	}

	/**
	 * Get latest version for a form
	 *
	 * @param string $form_id Form UUID.
	 * @return array|null Latest version data or null if not found.
	 */
	public function get_latest_form_version( $form_id ) {
		return $this->form_versions_table->get_latest_version( $form_id );
	}

	/**
	 * Get versions by form ID
	 *
	 * @param string $form_id Form UUID.
	 * @param int    $limit Number of versions to return.
	 * @param int    $offset Offset for pagination.
	 * @return array Array of version data.
	 */
	public function get_form_versions( $form_id, $limit = 10, $offset = 0 ) {
		return $this->form_versions_table->get_versions_by_form_id( $form_id, $limit, $offset );
	}
}