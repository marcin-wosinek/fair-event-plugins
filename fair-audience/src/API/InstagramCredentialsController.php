<?php
/**
 * Instagram credential status REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Settings\InstagramCredentials;
use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Reports whether the stored Instagram connection can be used. Owned by
 * fair-audience, which stores the token, so the settings screen can show it
 * whether or not the experimental companion that uses the token is active.
 */
class InstagramCredentialsController extends WP_REST_Controller {

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
	protected $rest_base = 'instagram/credentials';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/instagram/credentials.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_status' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
				),
			)
		);
	}

	/**
	 * Credential status. `connected` is the stored connection flag, which
	 * stays set while the token is unreadable; `usable` is whether Instagram
	 * can actually be used. The token itself is never part of the response.
	 *
	 * @return \WP_REST_Response
	 */
	public function get_status() {
		$status = InstagramCredentials::status();

		return rest_ensure_response(
			array(
				'connected'             => (bool) get_option( InstagramCredentials::CONNECTED_OPTION, false ),
				'usable'                => InstagramCredentials::is_connected(),
				'credential_status'     => $status,
				'credentials_encrypted' => InstagramCredentials::is_encrypted(),
				'message'               => InstagramCredentials::admin_message( $status ),
			)
		);
	}

	/**
	 * Check admin permissions.
	 *
	 * @return bool
	 */
	public function admin_permissions_check() {
		return current_user_can( 'manage_options' );
	}
}
