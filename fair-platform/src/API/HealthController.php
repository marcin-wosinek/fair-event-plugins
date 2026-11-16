<?php
/**
 * Health REST API controller
 *
 * @package FairPlatform
 */

namespace FairPlatform\API;

use FairPlatform\Core\Health;
use WP_REST_Controller;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || die;

/**
 * GET /fair-platform/v1/health: whether the Mollie OAuth proxy is running
 * and configured (#2290).
 *
 * The route exists only once the plugin has started, after the shared
 * library loader allowed it. A paused or inactive plugin therefore has no
 * route at all, and callers must treat a missing route, a redirect or HTML
 * as down.
 */
class HealthController extends WP_REST_Controller {

	/**
	 * Namespace for REST routes
	 *
	 * @var string
	 */
	protected $namespace = 'fair-platform/v1';

	/**
	 * Base for REST routes
	 *
	 * @var string
	 */
	protected $rest_base = 'health';

	/**
	 * Register REST routes
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					// Intentionally public: the post-deploy check and the
					// external uptime monitor call it anonymously. It is
					// read-only, makes no outbound request, and returns only a
					// fixed service identifier and status.
					'permission_callback' => '__return_true',
				),
			)
		);
	}

	/**
	 * Report the proxy's health.
	 *
	 * @param \WP_REST_Request $request Request object.
	 * @return WP_REST_Response
	 */
	public function get_item( $request ) {
		unset( $request );

		$healthy  = Health::check();
		$response = new WP_REST_Response( Health::body( $healthy ), Health::status_code( $healthy ) );

		// A cached answer would keep reporting a proxy that has since gone
		// down (or come back), so no layer may store it.
		foreach ( wp_get_nocache_headers() as $name => $value ) {
			if ( ! empty( $value ) ) {
				$response->header( $name, $value );
			}
		}
		$response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );

		return $response;
	}
}
