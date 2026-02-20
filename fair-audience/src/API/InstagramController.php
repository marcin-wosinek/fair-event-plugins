<?php
/**
 * Instagram REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for Instagram integration.
 */
class InstagramController extends WP_REST_Controller {

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
	protected $rest_base = 'instagram';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// POST /fair-audience/v1/instagram/test-connection.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/test-connection',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'test_connection' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
				),
			)
		);
	}

	/**
	 * Test Instagram connection by calling the API.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function test_connection( $request ) {
		$access_token = get_option( 'fair_audience_instagram_access_token', '' );

		if ( empty( $access_token ) ) {
			return new WP_Error(
				'no_token',
				__( 'No Instagram access token configured.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$result = $this->test_instagram_token( $access_token );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response( $result );
	}

	/**
	 * Test Instagram token validity via graph.instagram.com/me.
	 *
	 * @param string $access_token The access token.
	 * @return array|WP_Error Result or error.
	 */
	private function test_instagram_token( $access_token ) {
		$url = 'https://graph.instagram.com/me?' . http_build_query(
			array(
				'fields'       => 'user_id,username',
				'access_token' => $access_token,
			)
		);

		$response = wp_remote_get(
			$url,
			array( 'timeout' => 30 )
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'connection_failed',
				__( 'Failed to connect to Instagram API.', 'fair-audience' ),
				array(
					'status'  => 500,
					'details' => $response->get_error_message(),
				)
			);
		}

		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		if ( isset( $data['error'] ) ) {
			return new WP_Error(
				'token_invalid',
				__( 'The access token is invalid or expired.', 'fair-audience' ),
				array(
					'status'  => 401,
					'details' => $data['error']['message'] ?? '',
				)
			);
		}

		$user_id  = $data['user_id'] ?? $data['id'] ?? '';
		$username = $data['username'] ?? '';

		// Update stored account info.
		if ( ! empty( $user_id ) ) {
			update_option( 'fair_audience_instagram_user_id', $user_id );
		}
		if ( ! empty( $username ) ) {
			update_option( 'fair_audience_instagram_username', $username );
		}

		$expires_at = (int) get_option( 'fair_audience_instagram_token_expires', 0 );

		return array(
			'success'            => true,
			'message'            => __( 'Token is valid!', 'fair-audience' ),
			'token_info'         => array(
				'expires_at' => $expires_at,
				'expires_in' => $expires_at > 0 ? $expires_at - time() : null,
			),
			'instagram_accounts' => array(
				array(
					'id'       => $user_id,
					'username' => $username,
					'page'     => __( 'Instagram Account', 'fair-audience' ),
				),
			),
		);
	}

	/**
	 * Check admin permissions.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function admin_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
