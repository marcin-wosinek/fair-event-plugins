<?php
/**
 * Plugin core class for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Core;

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
		// This companion is never distributed on WordPress.org, so it always
		// bundles its own translation files rather than waiting on a language
		// pack that will never exist.
		add_action(
			'init',
			function () {
				load_plugin_textdomain( 'fair-payments-connector-experimental', false, 'fair-payments-connector-experimental/languages' );
			}
		);

		$migration = new \FairPaymentsConnectorExperimental\Migration\Migration();
		$migration->init();

		new \FairPaymentsConnectorExperimental\API\RestHooks();

		$notifications = new \FairPaymentsConnectorExperimental\Hooks\NotificationHooks();
		$notifications->init();

		$digest = new \FairPaymentsConnectorExperimental\Hooks\DigestHooks();
		$digest->init();

		$settings = new \FairPaymentsConnectorExperimental\Settings\Settings();
		$settings->init();

		if ( is_admin() ) {
			$admin = new \FairPaymentsConnectorExperimental\Admin\AdminPages();
			$admin->init();
		}
	}

	/**
	 * Private constructor to prevent instantiation
	 */
	private function __construct() {
		$this->init();
	}

	/**
	 * Prevent cloning the singleton.
	 */
	private function __clone() {}

	/**
	 * Prevent unserializing the singleton.
	 */
	public function __wakeup() {}
}
