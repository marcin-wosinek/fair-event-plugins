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
		add_action(
			'init',
			function () {
				if ( Features::is_enabled( 'bundled-translations' ) ) {
					load_plugin_textdomain( 'fair-payments-connector-experimental', false, 'fair-payments-connector-experimental/languages' );
				}
			}
		);

		new \FairPaymentsConnectorExperimental\API\RestHooks();

		$notifications = new \FairPaymentsConnectorExperimental\Hooks\NotificationHooks();
		$notifications->init();

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

	private function __clone() {}

	public function __wakeup() {}
}
