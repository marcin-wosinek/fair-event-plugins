<?php
/**
 * Public external REST API controller for token introspection.
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnectorExperimental\Models\ApiToken;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Handles the public GET /external/me endpoint.
 */
class ExternalMeController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Register the route for token introspection.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/external/me',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => ApiTokenAuth::require_token(),
				),
			)
		);
	}

	/**
	 * Return the authenticated token's label and scopes.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_item( $request ) {
		$row = $request->get_param( '_fair_api_token' );

		return new WP_REST_Response( ApiToken::to_array( $row ), 200 );
	}
}
