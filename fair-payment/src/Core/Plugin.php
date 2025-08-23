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
		$this->load_hooks();
	}

	/**
	 * Load all plugin hooks and functionality
	 *
	 * @return void
	 */
	private function load_hooks() {
		new \FairPayment\Hooks\BlockHooks();
		new \FairPayment\Hooks\AdminHooks();
		new \FairPayment\Hooks\RoutesHooks();
		new \FairPayment\Hooks\ApiHooks();
	}
}
