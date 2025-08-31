<?php
/**
 * Plugin core class for Fair Schedule Blocks
 *
 * @package FairScheduleBlocks
 */

namespace FairScheduleBlocks\Core;

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
		new \FairScheduleBlocks\Hooks\BlockHooks();
	}
}
