<?php
/**
 * REST API hooks for shared endpoints
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\API;

defined( 'WPINC' ) || die;

/**
 * Registers shared REST API endpoints.
 *
 * Ensures the endpoint is registered only once even if multiple plugins
 * instantiate this class.
 */
class RestHooks {

	/**
	 * Whether routes have already been registered.
	 *
	 * @var bool
	 */
	private static $registered = false;

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		if ( self::$registered ) {
			return;
		}
		self::$registered = true;

		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		$controller = new BlockRenderController();
		$controller->register_routes();
	}
}
