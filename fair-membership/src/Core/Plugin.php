<?php
/**
 * Plugin core class for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Core;

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
	 * Initialize the plugin
	 *
	 * @return void
	 */
	public function init() {
		// Load text domain for translations
		add_action( 'init', array( $this, 'load_textdomain' ) );

		// Check for database upgrades
		$this->maybe_upgrade_database();

		$this->load_hooks();
	}

	/**
	 * Load plugin textdomain for translations
	 *
	 * @return void
	 */
	public function load_textdomain() {
		load_plugin_textdomain(
			'fair-membership',
			false,
			basename( dirname( __DIR__, 2 ) ) . '/languages'
		);
	}

	/**
	 * Check and perform database upgrades if needed
	 *
	 * @return void
	 */
	private function maybe_upgrade_database() {
		\FairMembership\Database\Installer::maybe_upgrade();
	}

	/**
	 * Load all plugin hooks and functionality
	 *
	 * @return void
	 */
	private function load_hooks() {
		new \FairMembership\Hooks\BlockHooks();
		new \FairMembership\API\RestAPI();
		new \FairMembership\Hooks\PaymentHooks();

		if ( is_admin() ) {
			new \FairMembership\Admin\AdminHooks();
			new \FairMembership\Hooks\UserHooks();
		}
	}

	/**
	 * Private constructor to prevent instantiation
	 */
	private function __construct() {
		// Prevent instantiation
	}

	/**
	 * Prevent cloning
	 *
	 * @return void
	 */
	private function __clone() {
		// Prevent cloning
	}

	/**
	 * Prevent unserialization
	 *
	 * @return void
	 */
	public function __wakeup() {
		// Prevent unserialization
	}
}
