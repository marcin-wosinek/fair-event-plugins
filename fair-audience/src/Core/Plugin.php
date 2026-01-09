<?php
/**
 * Core Plugin Class
 *
 * @package FairAudience
 */

namespace FairAudience\Core;

defined( 'ABSPATH' ) || die;

/**
 * Main plugin class (singleton).
 */
class Plugin {

	/**
	 * Singleton instance.
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Get singleton instance.
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
	 * Private constructor to prevent direct instantiation.
	 */
	private function __construct() {
		// Private constructor.
	}

	/**
	 * Initialize the plugin.
	 */
	public function init() {
		add_action( 'rest_api_init', array( $this, 'register_api_endpoints' ) );

		// Initialize admin.
		$admin_hooks = new \FairAudience\Admin\AdminHooks();
	}

	/**
	 * Register REST API endpoints.
	 */
	public function register_api_endpoints() {
		$participants_controller = new \FairAudience\API\ParticipantsController();
		$participants_controller->register_routes();

		$event_participants_controller = new \FairAudience\API\EventParticipantsController();
		$event_participants_controller->register_routes();
	}
}
