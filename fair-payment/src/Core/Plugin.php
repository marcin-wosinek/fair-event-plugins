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
		add_action( 'rest_api_init', array( $this, 'register_api_endpoints' ) );
		$this->load_admin();
		$this->load_settings();
	}

	/**
	 * Register REST API endpoints
	 *
	 * @return void
	 */
	public function register_api_endpoints() {
		$payment_endpoint = new \FairPayment\API\PaymentEndpoint();
		$payment_endpoint->register_routes();

		$webhook_endpoint = new \FairPayment\API\WebhookEndpoint();
		$webhook_endpoint->register_routes();
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
