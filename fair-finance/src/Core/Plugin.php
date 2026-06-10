<?php
/**
 * Main Plugin Class
 *
 * @package FairFinance
 */

namespace FairFinance\Core;

use FairFinance\Database\Schema;

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
		new \FairFinance\API\RestHooks();
		if ( is_admin() ) {
			( new \FairFinance\Admin\AdminPages() )->init();
		}
	}

	/**
	 * Plugin activation hook
	 *
	 * @return void
	 */
	public static function activate() {
		Schema::create_tables();
	}

	/**
	 * Plugin deactivation hook
	 *
	 * @return void
	 */
	public static function deactivate() {
	}
}
