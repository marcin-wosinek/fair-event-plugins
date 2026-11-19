<?php
/**
 * Instagram handoff redemption REST API
 *
 * @package FairPlatform
 */

namespace FairPlatform\API;

use FairPlatform\OAuth\InstagramOAuthException;
use FairPlatform\OAuth\InstagramUnifiedLogin;
use FairPlatform\OAuth\OneTimeStore;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || die;

/**
 * `POST /fair-platform/v1/instagram/redeem`: a connecting site's server
 * exchanges the single-use handoff code from its return URL, with the
 * verifier only that server knows, for the Instagram credentials.
 */
class InstagramHandoffController extends WP_REST_Controller {

	/**
	 * Store of handoff codes, shared with the OAuth callback.
	 */
	const STORE = 'ig_handoff';

	/**
	 * Namespace for REST routes.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-platform/v1';

	/**
	 * Base for REST routes.
	 *
	 * @var string
	 */
	protected $rest_base = 'instagram/redeem';

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'redeem' ),
					// Intentionally public: called server to server by the
					// connecting site, which has no account here. The handoff
					// code and the verifier together are the credential,
					// checked in the callback; each code works once.
					'permission_callback' => '__return_true',
					'args'                => array(
						'handoff'       => array(
							'type'     => 'string',
							'required' => true,
						),
						'code_verifier' => array(
							'type'     => 'string',
							'required' => true,
						),
						'site_url'      => array(
							'type'     => 'string',
							'required' => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Redeem a handoff code. The code is used up by any attempt, valid or
	 * not, so it cannot be guessed against.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function redeem( $request ) {
		$payload = ( new OneTimeStore( self::STORE ) )->take( (string) $request['handoff'] );

		try {
			$credentials = InstagramUnifiedLogin::redemption( $payload, (string) $request['code_verifier'], (string) $request['site_url'] );
		} catch ( InstagramOAuthException $e ) {
			return new WP_Error(
				'instagram_handoff_invalid',
				'The Instagram handoff code is unknown, expired, already used, or does not belong to this site. Connect again.',
				array( 'status' => 400 )
			);
		}

		$response = new WP_REST_Response( $credentials );
		$response->header( 'Cache-Control', 'no-store' );

		return $response;
	}
}
