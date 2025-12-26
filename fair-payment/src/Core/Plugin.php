<?php
/**
 * Plugin core class for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Core;

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
		add_action( 'init', array( $this, 'register_blocks' ) );

		// Initialize REST API hooks.
		new \FairPayment\API\RestHooks();

		$this->load_admin();
		$this->load_settings();
		$this->load_migration_notice();
	}

	/**
	 * Register blocks
	 *
	 * @return void
	 */
	public function register_blocks() {
		// Register simple-payment block from build directory
		register_block_type(
			FAIR_PAYMENT_PLUGIN_DIR . 'build/blocks/simple-payment'
		);
	}

	/**
	 * Load and initialize admin pages
	 *
	 * @return void
	 */
	private function load_admin() {
		if ( is_admin() ) {
			$admin = new \FairPayment\Admin\AdminPages();
			$admin->init();
		}
	}

	/**
	 * Load and initialize settings
	 *
	 * @return void
	 */
	private function load_settings() {
		$settings = new \FairPayment\Settings\Settings();
		$settings->init();
	}

	/**
	 * Load and initialize migration notice
	 *
	 * @return void
	 */
	private function load_migration_notice() {
		if ( is_admin() ) {
			$migration_notice = new \FairPayment\Admin\MigrationNotice();
			$migration_notice->init();
		}
	}

	/**
	 * Private constructor to prevent instantiation
	 */
	private function __construct() {
		// Prevent instantiation.
	}

	/**
	 * Prevent cloning
	 *
	 * @return void
	 */
	private function __clone() {
		// Prevent cloning.
	}

	/**
	 * Prevent unserialization
	 *
	 * @return void
	 */
	public function __wakeup() {
		// Prevent unserialization.
	}
}
