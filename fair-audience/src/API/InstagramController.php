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

		$result = $this->test_facebook_token( $access_token );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response( $result );
	}

	/**
	 * Test Facebook token validity.
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
				__( 'Failed to connect to Facebook API.', 'fair-audience' ),
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
				__( 'The access token is invalid.', 'fair-audience' ),
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
				__( 'The access token is no longer valid.', 'fair-audience' ),
				array(
					'status'  => 401,
					'details' => $token_data['error']['message'] ?? '',
				)
			);
		}

		$instagram_accounts = array();

		// First, try Instagram Basic Display API (for personal/creator accounts).
		$instagram_me_url = 'https://graph.instagram.com/me?' . http_build_query(
			array(
				'access_token' => $access_token,
				'fields'       => 'id,username',
			)
		);

		$instagram_me_response = wp_remote_get(
			$instagram_me_url,
			array(
				'timeout' => 30,
			)
		);

		if ( ! is_wp_error( $instagram_me_response ) ) {
			$instagram_me_body = wp_remote_retrieve_body( $instagram_me_response );
			$instagram_me_data = json_decode( $instagram_me_body, true );

			if ( isset( $instagram_me_data['id'] ) && ! isset( $instagram_me_data['error'] ) ) {
				$instagram_accounts[] = array(
					'id'       => $instagram_me_data['id'],
					'username' => $instagram_me_data['username'] ?? '',
					'page'     => __( 'Instagram Account', 'fair-audience' ),
				);
			}
		}

		// If no account found yet, try Facebook Pages with linked Instagram Business accounts.
		if ( empty( $instagram_accounts ) ) {
			$pages_url = 'https://graph.facebook.com/v24.0/me/accounts?' . http_build_query(
				array(
					'access_token' => $access_token,
					'fields'       => 'id,name,instagram_business_account{id,username}',
				)
			);

			$pages_response = wp_remote_get(
				$pages_url,
				array(
					'timeout' => 30,
				)
			);

			if ( ! is_wp_error( $pages_response ) ) {
				$pages_body = wp_remote_retrieve_body( $pages_response );
				$pages_data = json_decode( $pages_body, true );

				if ( isset( $pages_data['data'] ) && is_array( $pages_data['data'] ) ) {
					foreach ( $pages_data['data'] as $page ) {
						if ( isset( $page['instagram_business_account'] ) ) {
							$instagram_accounts[] = array(
								'id'       => $page['instagram_business_account']['id'],
								'username' => $page['instagram_business_account']['username'] ?? '',
								'page'     => $page['name'],
							);
						}
					}
				}
			}
		}

		// If we found Instagram accounts, save the first one's ID and username.
		if ( ! empty( $instagram_accounts ) ) {
			$first_account = $instagram_accounts[0];
			update_option( 'fair_audience_instagram_user_id', $first_account['id'] );
			update_option( 'fair_audience_instagram_username', $first_account['username'] );
		}

		$expires_at = $token_data['expires_at'] ?? 0;

		return array(
			'success'            => true,
			'message'            => __( 'Token is valid!', 'fair-audience' ),
			'token_info'         => array(
				'app_id'     => $token_data['app_id'] ?? '',
				'expires_at' => $expires_at,
				'expires_in' => $expires_at > 0 ? $expires_at - time() : null,
				'scopes'     => $token_data['scopes'] ?? array(),
			),
			'instagram_accounts' => $instagram_accounts,
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
