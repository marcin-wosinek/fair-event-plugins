<?php
/**
 * Meta Graph API calls of the Instagram Unified Login flow
 *
 * @package FairPlatform
 */

namespace FairPlatform\OAuth;

defined( 'ABSPATH' ) || die;

// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped -- exceptions carry fixed InstagramUnifiedLogin::ERROR_* codes and are never printed.

/**
 * The three server-side requests the callback makes to graph.facebook.com.
 *
 * Failures become InstagramOAuthException codes. Nothing here logs or
 * returns a token, the app secret, or a provider message that could echo
 * them.
 */
class InstagramMetaClient {

	/**
	 * Unified Login configuration.
	 *
	 * @var array
	 */
	private $config;

	/**
	 * Constructor.
	 *
	 * @param array $config From InstagramUnifiedLogin::config().
	 */
	public function __construct( array $config ) {
		$this->config = $config;
	}

	/**
	 * Exchange an authorization code for an access token.
	 *
	 * @param string $code         Authorization code.
	 * @param string $redirect_uri The callback URL the dialog used.
	 * @return string Access token.
	 * @throws InstagramOAuthException ERROR_EXCHANGE_FAILED.
	 */
	public function exchange_code( $code, $redirect_uri ) {
		$body = $this->get(
			'/oauth/access_token',
			array(
				'client_id'     => $this->config['app_id'],
				'client_secret' => $this->config['app_secret'],
				'redirect_uri'  => $redirect_uri,
				'code'          => $code,
			)
		);

		if ( empty( $body['access_token'] ) || ! is_string( $body['access_token'] ) || strlen( $body['access_token'] ) > 2048 || preg_match( '/\s/', $body['access_token'] ) ) {
			throw new InstagramOAuthException( InstagramUnifiedLogin::ERROR_EXCHANGE_FAILED );
		}

		return $body['access_token'];
	}

	/**
	 * What Meta reports about a token (`debug_token`, with the app token).
	 *
	 * @param string $access_token Access token.
	 * @return array Decoded response.
	 * @throws InstagramOAuthException ERROR_EXCHANGE_FAILED.
	 */
	public function debug_token( $access_token ) {
		return $this->get(
			'/debug_token',
			array(
				'input_token'  => $access_token,
				'access_token' => $this->config['app_id'] . '|' . $this->config['app_secret'],
			)
		);
	}

	/**
	 * Instagram accounts the business shared with the app.
	 *
	 * @param string $access_token Access token.
	 * @return array Decoded response.
	 * @throws InstagramOAuthException ERROR_EXCHANGE_FAILED.
	 */
	public function assigned_instagram_accounts( $access_token ) {
		return $this->get(
			'/me/assigned_instagram_accounts',
			array(
				'fields'       => 'id,username',
				'limit'        => 2,
				'access_token' => $access_token,
			)
		);
	}

	/**
	 * GET a Graph API path.
	 *
	 * @param string $path  Path after the version.
	 * @param array  $query Query parameters.
	 * @return array Decoded body.
	 * @throws InstagramOAuthException ERROR_EXCHANGE_FAILED.
	 */
	private function get( $path, array $query ) {
		$response = wp_remote_get(
			'https://graph.facebook.com/' . $this->config['graph_version'] . $path . '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 ),
			array(
				'timeout'     => 30,
				'redirection' => 0,
			)
		);

		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			throw new InstagramOAuthException( InstagramUnifiedLogin::ERROR_EXCHANGE_FAILED );
		}

		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $body ) || isset( $body['error'] ) ) {
			throw new InstagramOAuthException( InstagramUnifiedLogin::ERROR_EXCHANGE_FAILED );
		}

		return $body;
	}
}
