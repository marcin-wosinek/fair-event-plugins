<?php
/**
 * Shared token introspection endpoint for data sharing APIs
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\API;

defined( 'WPINC' ) || die;

use FairEventsShared\ApiTokens\AbstractApiTokenAuth;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Handles the public GET /external/me endpoint.
 *
 * A plugin's controller extends this one, sets its REST `$namespace` and
 * names its token model and auth class (subclasses of
 * FairEventsShared\ApiTokens\AbstractApiToken and AbstractApiTokenAuth).
 *
 * Plugins bundling different versions of this package can be active
 * together, and either copy may be the one loaded. Keep this class
 * additive: never add an abstract method or change a signature.
 */
abstract class AbstractExternalMeController extends WP_REST_Controller {

	/**
	 * Token model class, a subclass of AbstractApiToken.
	 *
	 * @return string Class name.
	 */
	abstract protected function token_model();

	/**
	 * Auth class, a subclass of AbstractApiTokenAuth.
	 *
	 * @return string Class name.
	 */
	abstract protected function auth_class();

	/**
	 * Register the route for token introspection.
	 *
	 * @return void
	 */
	public function register_routes() {
		$auth = $this->auth_class();

		register_rest_route(
			$this->namespace,
			'/external/me',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => $auth::require_token(),
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
		$model = $this->token_model();
		$row   = $request->get_param( AbstractApiTokenAuth::TOKEN_PARAM );

		return new WP_REST_Response( $model::to_array( $row ), 200 );
	}
}
