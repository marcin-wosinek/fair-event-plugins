<?php
/**
 * Facebook REST API Controller
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for Facebook integration.
 */
class FacebookController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'facebook';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// POST /fair-events/v1/facebook/test-connection.
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
	 * Test Facebook connection by calling the Graph API.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function test_connection( $request ) {
		$access_token = get_option( 'fair_events_facebook_access_token', '' );

		if ( empty( $access_token ) ) {
			return new WP_Error(
				'no_token',
				__( 'No Facebook access token configured.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$result = $this->test_facebook_token( $access_token );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response( $result );
	}

	/**
	 * Test Facebook token validity and fetch available Pages.
	 *
	 * @param string $access_token The access token.
	 * @return array|WP_Error Result or error.
	 */
	private function test_facebook_token( $access_token ) {
		// First, debug the token to check validity.
		$debug_url = 'https://graph.facebook.com/debug_token?' . http_build_query(
			array(
				'input_token'  => $access_token,
				'access_token' => $access_token,
			)
		);

		$response = wp_remote_get(
			$debug_url,
			array(
				'timeout' => 30,
			)
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'connection_failed',
				__( 'Failed to connect to Facebook API.', 'fair-events' ),
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
				__( 'The access token is invalid.', 'fair-events' ),
				array(
					'status'  => 401,
					'details' => $data['error']['message'] ?? '',
				)
			);
		}

		$token_data = $data['data'] ?? array();

		if ( ! ( $token_data['is_valid'] ?? false ) ) {
			return new WP_Error(
				'token_invalid',
				__( 'The access token is no longer valid.', 'fair-events' ),
				array(
					'status'  => 401,
					'details' => $token_data['error']['message'] ?? '',
				)
			);
		}

		// Fetch available Facebook Pages.
		$pages_url = 'https://graph.facebook.com/v24.0/me/accounts?' . http_build_query(
			array(
				'access_token' => $access_token,
				'fields'       => 'id,name,access_token',
			)
		);

		$pages_response = wp_remote_get(
			$pages_url,
			array(
				'timeout' => 30,
			)
		);

		$facebook_pages = array();

		if ( ! is_wp_error( $pages_response ) ) {
			$pages_body = wp_remote_retrieve_body( $pages_response );
			$pages_data = json_decode( $pages_body, true );

			if ( isset( $pages_data['data'] ) && is_array( $pages_data['data'] ) ) {
				foreach ( $pages_data['data'] as $page ) {
					$facebook_pages[] = array(
						'id'   => $page['id'],
						'name' => $page['name'],
					);
				}
			}
		}

		// If we found Facebook Pages, save the first one's ID and name.
		if ( ! empty( $facebook_pages ) ) {
			$first_page = $facebook_pages[0];
			update_option( 'fair_events_facebook_page_id', $first_page['id'] );
			update_option( 'fair_events_facebook_page_name', $first_page['name'] );
			update_option( 'fair_events_facebook_connected', true );
		}

		$expires_at = $token_data['expires_at'] ?? 0;

		// Save token expiration.
		if ( $expires_at > 0 ) {
			update_option( 'fair_events_facebook_token_expires', $expires_at );
		}

		return array(
			'success'        => true,
			'message'        => __( 'Token is valid!', 'fair-events' ),
			'token_info'     => array(
				'app_id'     => $token_data['app_id'] ?? '',
				'expires_at' => $expires_at,
				'expires_in' => $expires_at > 0 ? $expires_at - time() : null,
				'scopes'     => $token_data['scopes'] ?? array(),
			),
			'facebook_pages' => $facebook_pages,
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
