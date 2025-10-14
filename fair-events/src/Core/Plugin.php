<?php
/**
 * Plugin core class for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Core;

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
		add_action( 'init', array( $this, 'register_post_types' ) );
		$this->load_database();
		$this->load_hooks();
		$this->load_patterns();
		$this->load_admin();
		$this->load_settings();
	}

	/**
	 * Load and initialize database
	 *
	 * @return void
	 */
	private function load_database() {
		\FairEvents\Database\Installer::maybe_upgrade();
	}

	/**
	 * Load all plugin hooks and functionality
	 *
	 * @return void
	 */
	private function load_hooks() {
		new \FairEvents\Hooks\BlockHooks();
	}

	/**
	 * Load and initialize block patterns
	 *
	 * @return void
	 */
	private function load_patterns() {
		$patterns = new \FairEvents\Patterns\Patterns();
		$patterns->init();
	}

	/**
	 * Load and initialize admin pages
	 *
	 * @return void
	 */
	private function load_admin() {
		if ( is_admin() ) {
			$admin = new \FairEvents\Admin\AdminPages();
			$admin->init();
		}
	}

	/**
	 * Load and initialize settings
	 *
	 * @return void
	 */
	private function load_settings() {
		$settings = new \FairEvents\Settings\Settings();
		$settings->init();
	}

	/**
	 * Register custom post types
	 *
	 * @return void
	 */
	public function register_post_types() {
		\FairEvents\PostTypes\Event::register();
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
