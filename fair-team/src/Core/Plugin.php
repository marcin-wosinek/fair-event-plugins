<?php
/**
 * Main plugin class
 *
 * @package FairTeam\Core
 */

namespace FairTeam\Core;

defined( 'ABSPATH' ) || die;

/**
 * Main plugin class
 */
class Plugin {
	/**
	 * Plugin instance
	 *
	 * @var Plugin
	 */
	private static $instance = null;

	/**
	 * Get plugin instance
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
		// Private constructor to prevent direct instantiation.
	}

	/**
	 * Initialize plugin
	 */
	public function init() {
		// Register hooks.
		add_action( 'init', array( $this, 'register_hooks' ) );
	}

	/**
	 * Register WordPress hooks
	 */
	public function register_hooks() {
		// Register blocks, post types, taxonomies, etc.
		// TODO: Implement team member linking functionality.
	}
}
