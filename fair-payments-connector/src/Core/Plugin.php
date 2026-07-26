<?php
/**
 * Plugin core class for Fair Payments Connector
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Core;

use FairEventsShared\Money;

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
		// Default: rely on WordPress.org language packs. The `bundled-translations`
		// feature flag opts into loading the .mo files we ship in `languages/`.
		add_action(
			'init',
			function () {
				if ( Features::is_enabled( 'bundled-translations' ) ) {
					load_plugin_textdomain( 'fair-payments-connector', false, 'fair-payments-connector/languages' );
				}
			}
		);

		add_action( 'init', array( $this, 'register_blocks' ) );
		add_action( 'enqueue_block_editor_assets', array( $this, 'localize_block_editor_data' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_callback_script' ) );

		// Initialize REST API hooks.
		new \FairPaymentsConnector\API\RestHooks();

		// Shared REST API endpoints (block renderer).
		new \FairEventsShared\API\RestHooks();

		$this->load_admin();
		$this->load_settings();
		$this->load_migration_notice();
		$this->load_shared_settings_page();
	}

	/**
	 * Boot the shared central "Fair Event Plugins" settings screen and
	 * register this plugin's bundled-translations row on it.
	 *
	 * @return void
	 */
	private function load_shared_settings_page() {
		if ( ! is_admin() ) {
			return;
		}

		if ( class_exists( '\FairEventsShared\Admin\SettingsPage' ) ) {
			\FairEventsShared\Admin\SettingsPage::boot();
		}

		add_filter( 'fair_event_plugins_settings_fields', array( $this, 'register_shared_settings_fields' ) );
	}

	/**
	 * Register this plugin's bundled-translations row on the shared screen.
	 *
	 * @param array $fields Field descriptors collected so far.
	 * @return array Field descriptors with this plugin's row appended.
	 */
	public function register_shared_settings_fields( $fields ) {
		$fields[] = array(
			'section'       => 'translations',
			'section_title' => __( 'Translations', 'fair-payments-connector' ),
			'id'            => 'fair-payments-connector/bundled-translations',
			'type'          => 'checkbox',
			'option'        => Features::OPTION,
			'key'           => 'bundled-translations',
			'label'         => __( 'Fair Payments Connector', 'fair-payments-connector' ),
			'description'   => __( 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs. Useful while a locale is below the 90% threshold on translate.wordpress.org or for in-progress strings.', 'fair-payments-connector' ),
			'value'         => Features::is_enabled( 'bundled-translations' ),
			'locked'        => Features::is_forced( 'bundled-translations' ),
			'locked_note'   => __( 'Forced by a wp-config constant — change it there.', 'fair-payments-connector' ),
		);
		return $fields;
	}

	/**
	 * Expose site-wide payment settings to the block editor via a JS global.
	 *
	 * Allows block editor scripts to read the configured currency without an
	 * extra REST round-trip (e.g. to seed the simple-payment block default).
	 *
	 * @return void
	 */
	public function localize_block_editor_data() {
		wp_add_inline_script(
			'fair-payment-simple-payment-editor-script',
			'window.fairPaymentsConnector = window.fairPaymentsConnector || {}; window.fairPaymentsConnector.currency = ' . wp_json_encode( Money::site_currency() ) . ';',
			'before'
		);
	}

	/**
	 * Register blocks
	 *
	 * @return void
	 */
	public function register_blocks() {
		// Register simple-payment block from build directory.
		register_block_type(
			FAIR_PAYMENTS_CONNECTOR_PLUGIN_DIR . 'build/blocks/simple-payment'
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

		$asset_file = FAIR_PAYMENTS_CONNECTOR_PLUGIN_DIR . 'build/payment-callback.asset.php';

		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset = require $asset_file;

		wp_enqueue_script(
			'fair-payments-connector-callback',
			FAIR_PAYMENTS_CONNECTOR_PLUGIN_URL . 'build/payment-callback.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_enqueue_style(
			'fair-payments-connector-callback',
			FAIR_PAYMENTS_CONNECTOR_PLUGIN_URL . 'build/payment-callback.css',
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
			$admin = new \FairPaymentsConnector\Admin\AdminPages();
			$admin->init();
		}
	}

	/**
	 * Load and initialize settings
	 *
	 * @return void
	 */
	private function load_settings() {
		$settings = new \FairPaymentsConnector\Settings\Settings();
		$settings->init();
	}

	/**
	 * Load and initialize migration notice
	 *
	 * @return void
	 */
	private function load_migration_notice() {
		if ( is_admin() ) {
			$migration_notice = new \FairPaymentsConnector\Admin\MigrationNotice();
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
