<?php
/**
 * Audience Session REST API Controller
 *
 * Exposes a single endpoint that clears the audience session cookie. Used by
 * the "Not you?" affordance on signup forms.
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Services\AudienceSession;
use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * REST API controller for the audience session cookie.
 */
class SessionController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-audience/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'session';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// DELETE /fair-audience/v1/session — clear the cookie.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'clear' ),
					'permission_callback' => '__return_true',
				),
			)
		);
	}

	/**
	 * Clear the audience session cookie.
	 *
	 * @return \WP_REST_Response
	 */
	public function clear() {
		AudienceSession::clear();
		return rest_ensure_response( array( 'success' => true ) );
	}
}
