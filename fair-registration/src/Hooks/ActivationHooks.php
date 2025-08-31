<?php
/**
 * Activation and deactivation hooks for Fair Registration
 *
 * @package FairRegistration
 */

namespace FairRegistration\Hooks;

use FairRegistration\Database\DatabaseManager;

defined( 'WPINC' ) || die;

/**
 * Handles plugin activation and deactivation
 */
class ActivationHooks {

	/**
	 * Database manager instance
	 *
	 * @var DatabaseManager
	 */
	private $db_manager;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->db_manager = new DatabaseManager();
	}

	/**
	 * Plugin activation hook
	 *
	 * @return void
	 */
	public function activate() {
		// Create database tables
		$this->db_manager->create_tables();

		// Set plugin version
		update_option( 'fair_registration_version', FAIR_REGISTRATION_VERSION ?? '1.0.0' );

		// Set activation timestamp
		update_option( 'fair_registration_activated_time', current_time( 'timestamp' ) );

		// Flush rewrite rules
		flush_rewrite_rules();
	}

	/**
	 * Plugin deactivation hook
	 *
	 * @return void
	 */
	public function deactivate() {
		// Flush rewrite rules
		flush_rewrite_rules();

		// Set deactivation timestamp
		update_option( 'fair_registration_deactivated_time', current_time( 'timestamp' ) );
	}

	/**
	 * Plugin uninstall hook
	 * Note: This should be called from uninstall.php file
	 *
	 * @return void
	 */
	public static function uninstall() {
		// Remove database tables
		$db_manager = new DatabaseManager();
		$db_manager->drop_tables();

		// Remove plugin options
		delete_option( 'fair_registration_version' );
		delete_option( 'fair_registration_db_version' );
		delete_option( 'fair_registration_activated_time' );
		delete_option( 'fair_registration_deactivated_time' );

		// Remove any transients
		delete_transient( 'fair_registration_stats' );

		// Flush rewrite rules
		flush_rewrite_rules();
	}

	/**
	 * Register activation and deactivation hooks
	 *
	 * @param string $plugin_file Main plugin file path.
	 * @return void
	 */
	public function register_hooks( $plugin_file ) {
		register_activation_hook( $plugin_file, array( $this, 'activate' ) );
		register_deactivation_hook( $plugin_file, array( $this, 'deactivate' ) );
	}
}
