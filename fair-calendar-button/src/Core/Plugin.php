<?php
/**
 * Plugin core class for Fair Calendar Button
 *
 * @package FairCalendarButton
 */

namespace FairCalendarButton\Core;

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
		$this->load_textdomain();
		$this->load_hooks();
	}

	/**
	 * Load plugin text domain for translations
	 *
	 * @return void
	 */
	private function load_textdomain() {
		add_action(
			'init',
			function () {
				load_plugin_textdomain(
					'fair-calendar-button',
					false,
					dirname( plugin_basename( __DIR__ . '/../../fair-calendar-button.php' ) ) . '/languages'
				);
			}
		);
	}

	/**
	 * Load all plugin hooks and functionality
	 *
	 * @return void
	 */
	private function load_hooks() {
		new \FairCalendarButton\Hooks\BlockHooks();
	}
}
