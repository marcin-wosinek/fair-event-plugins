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
		add_filter( 'query_vars', array( $this, 'add_query_vars' ) );
		add_action( 'template_redirect', array( $this, 'handle_poll_response' ) );

		// Initialize admin.
		$admin_hooks = new \FairAudience\Admin\AdminHooks();

		// Initialize media library integration.
		\FairAudience\Admin\MediaLibraryHooks::init();
	}

	/**
	 * Register REST API endpoints.
	 */
	public function register_api_endpoints() {
		$participants_controller = new \FairAudience\API\ParticipantsController();
		$participants_controller->register_routes();

		$event_participants_controller = new \FairAudience\API\EventParticipantsController();
		$event_participants_controller->register_routes();

		$import_controller = new \FairAudience\API\ImportController();
		$import_controller->register_routes();

		$polls_controller = new \FairAudience\API\PollsController();
		$polls_controller->register_routes();

		$poll_response_controller = new \FairAudience\API\PollResponseController();
		$poll_response_controller->register_routes();
	}

	/**
	 * Add custom query variables.
	 *
	 * @param array $vars Array of query variables.
	 * @return array Modified array of query variables.
	 */
	public function add_query_vars( $vars ) {
		$vars[] = 'poll_key';
		return $vars;
	}

	/**
	 * Handle poll response page requests.
	 */
	public function handle_poll_response() {
		$poll_key = get_query_var( 'poll_key' );

		if ( empty( $poll_key ) ) {
			return;
		}

		// Load poll template.
		include FAIR_AUDIENCE_PLUGIN_DIR . 'templates/poll-response.php';
		exit;
	}
}
