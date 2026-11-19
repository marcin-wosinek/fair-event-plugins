<?php
/**
 * Instagram REST API Controller
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\API;

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
		// Fair Events → Instagram tests the connection while it manages it.
		if ( \FairAudienceExperimental\Services\InstagramConnection::managed_by_events() ) {
			return new WP_Error(
				'instagram_connection_moved',
				__( 'The Instagram connection is managed in Fair Events → Instagram. Test it there.', 'fair-audience-experimental' ),
				array( 'status' => 409 )
			);
		}

		$reason = \FairAudienceExperimental\Services\InstagramConnection::unavailable_reason();
		if ( $reason ) {
			$credentials = \FairAudience\Settings\InstagramCredentials::class;
			return new WP_Error(
				$reason->get_error_code(),
				$reason->get_error_message(),
				array(
					'status'            => 409,
					'credential_status' => class_exists( $credentials ) ? $credentials::status() : null,
				)
			);
		}

		$result = $this->test_instagram_account(
			\FairAudienceExperimental\Services\InstagramConnection::access_token(),
			\FairAudienceExperimental\Services\InstagramConnection::user_id()
		);

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response( $result );
	}

	/**
	 * Check that the connected account can be read with the token, on
	 * graph.facebook.com (Instagram API with Unified Login).
	 *
	 * @param string $access_token The access token.
	 * @param string $account_id   Instagram account ID.
	 * @return array|WP_Error Result or error.
	 */
	private function test_instagram_account( $access_token, $account_id ) {
		$response = wp_remote_get(
			\FairAudienceExperimental\Services\InstagramConnection::graph_base() . '/' . rawurlencode( $account_id ) . '?fields=id,username',
			array(
				'timeout'     => 30,
				'redirection' => 0,
				'headers'     => array( 'Authorization' => 'Bearer ' . $access_token ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'connection_failed',
				__( 'Failed to connect to Instagram API.', 'fair-audience-experimental' ),
				array( 'status' => 502 )
			);
		}

		$data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$data = is_array( $data ) ? $data : array();

		if ( isset( $data['error'] ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) || (string) ( $data['id'] ?? '' ) !== (string) $account_id ) {
			$message = isset( $data['error']['message'] ) && is_string( $data['error']['message'] ) ? $data['error']['message'] : '';
			return new WP_Error(
				'token_invalid',
				__( 'Meta refused the access token or the connected account. Connect again in Fair Events → Instagram.', 'fair-audience-experimental' ),
				array(
					'status'  => 401,
					'details' => '' !== $access_token ? str_replace( $access_token, '[redacted]', $message ) : $message,
				)
			);
		}

		$username = isset( $data['username'] ) && is_string( $data['username'] ) ? sanitize_text_field( $data['username'] ) : '';
		if ( '' !== $username ) {
			update_option( 'fair_audience_instagram_username', $username );
		}

		return array(
			'success'            => true,
			'message'            => __( 'The connection works.', 'fair-audience-experimental' ),
			'instagram_accounts' => array(
				array(
					'id'       => (string) $account_id,
					'username' => $username,
					'page'     => __( 'Instagram Account', 'fair-audience-experimental' ),
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
