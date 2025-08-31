<?php
/**
 * Plugin core class for Fair Registration
 *
 * @package FairRegistration
 */

namespace FairRegistration\Core;

use FairRegistration\Database\DatabaseManager;

defined( 'WPINC' ) || die;

/**
 * Main plugin class implementing singleton pattern
 */
class Plugin {
	/**
	 * Single instance of the plugin
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Database manager instance
	 *
	 * @var DatabaseManager
	 */
	private $db_manager;

	/**
	 * Get singleton instance of the plugin
	 *
	 * @return Plugin Plugin instance
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Private constructor to prevent direct instantiation
	 */
	private function __construct() {
	}

	/**
	 * Private clone method to prevent cloning
	 */
	private function __clone() {
	}

	/**
	 * Public wakeup method to prevent unserialization
	 */
	public function __wakeup() {
	}

	/**
	 * Initialize the plugin
	 *
	 * @return void
	 */
	public function init() {
		$this->init_database();
		$this->load_hooks();
	}

	/**
	 * Initialize database manager
	 *
	 * @return void
	 */
	private function init_database() {
		$this->db_manager = new DatabaseManager();
		$this->db_manager->init();
	}

	/**
	 * Load all plugin hooks and functionality
	 *
	 * @return void
	 */
	private function load_hooks() {
		new \FairRegistration\Hooks\BlockHooks();
		new \FairRegistration\Hooks\ApiHooks();

		// Initialize admin hooks
		if ( is_admin() ) {
			new \FairRegistration\Hooks\AdminHooks();
		}
	}

	/**
	 * Get database manager instance
	 *
	 * @return DatabaseManager
	 */
	public function get_db_manager() {
		return $this->db_manager;
	}
}
