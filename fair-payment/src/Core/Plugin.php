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
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_callback_script' ) );

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
	 * Enqueue payment callback script when callback parameter is present
	 *
	 * @return void
	 */
	public function enqueue_callback_script() {
		// Check if fair_payment_callback parameter is present in URL.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( ! isset( $_GET['fair_payment_callback'] ) || 'true' !== $_GET['fair_payment_callback'] ) {
			return;
		}

		$asset_file = FAIR_PAYMENT_PLUGIN_DIR . 'build/payment-callback.asset.php';

		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset = require $asset_file;

		wp_enqueue_script(
			'fair-payment-callback',
			FAIR_PAYMENT_PLUGIN_URL . 'build/payment-callback.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_enqueue_style(
			'fair-payment-callback',
			FAIR_PAYMENT_PLUGIN_URL . 'build/payment-callback.css',
			array(),
			$asset['version']
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
