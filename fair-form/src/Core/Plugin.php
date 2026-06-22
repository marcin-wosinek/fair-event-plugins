<?php
/**
 * Main Plugin Class
 *
 * @package FairForm
 */

namespace FairForm\Core;

defined( 'ABSPATH' ) || die;

/**
 * Main plugin class
 */
class Plugin {
	/**
	 * Singleton instance
	 *
	 * @var Plugin
	 */
	private static $instance = null;

	/**
	 * Get singleton instance
	 *
	 * @return Plugin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Constructor
	 */
	private function __construct() {
		$this->init_hooks();
	}

	/**
	 * Initialize WordPress hooks
	 *
	 * @return void
	 */
	private function init_hooks() {
		add_action(
			'init',
			function () {
				if ( Features::is_enabled( 'bundled-translations' ) ) {
					load_plugin_textdomain( 'fair-form', false, 'fair-form/languages' );
				}
			}
		);
	}

	/**
	 * Plugin activation hook
	 *
	 * @return void
	 */
	public static function activate() {
	}

	/**
	 * Plugin deactivation hook
	 *
	 * @return void
	 */
	public static function deactivate() {
	}
}
