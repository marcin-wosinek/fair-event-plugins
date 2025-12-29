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
		add_action( 'init', array( $this, 'register_post_types' ) );
		add_action( 'init', array( $this, 'register_hooks' ) );
		add_action( 'rest_api_init', array( $this, 'register_api_endpoints' ) );

		// Initialize settings
		$settings = new \FairTeam\Settings\Settings();
		$settings->init();

		// Initialize admin pages
		$admin_pages = new \FairTeam\Admin\AdminPages();
		$admin_pages->init();

		// Initialize meta box hooks
		$meta_box_hooks = new \FairTeam\Hooks\MetaBoxHooks();
		$meta_box_hooks->init();

		// Initialize blocks
		new \FairTeam\Hooks\BlockHooks();
	}

	/**
	 * Register custom post types
	 *
	 * @return void
	 */
	public function register_post_types() {
		\FairTeam\PostTypes\TeamMember::register();
	}

	/**
	 * Register WordPress hooks
	 */
	public function register_hooks() {
		// Register blocks, post types, taxonomies, etc.
	}

	/**
	 * Register REST API endpoints
	 */
	public function register_api_endpoints() {
		$controller = new \FairTeam\API\PostTeamMembersController();
		$controller->register_routes();
	}
}
