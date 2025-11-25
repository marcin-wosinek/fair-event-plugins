<?php
/**
 * Plugin core class for Fair RSVP
 *
 * @package FairRsvp
 */

namespace FairRsvp\Core;

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
		$this->load_hooks();
	}

	/**
	 * Load all plugin hooks and functionality
	 *
	 * @return void
	 */
	private function load_hooks() {
		// Initialize block hooks.
		new \FairRsvp\Hooks\BlockHooks();

		// Initialize admin hooks.
		new \FairRsvp\Admin\AdminHooks();

		// Initialize REST API hooks.
		new \FairRsvp\REST\RestHooks();

		// Initialize frontend hooks.
		new \FairRsvp\Frontend\AttendanceCheckHooks();
	}
}
