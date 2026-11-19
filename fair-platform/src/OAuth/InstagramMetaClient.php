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
 * The server-side requests the callback makes to graph.facebook.com.
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
	 * One page of the Instagram accounts the business shared with the app.
	 *
	 * Further pages are requested with Meta's `after` cursor against the
	 * configured Graph endpoint; the `paging.next` URL in a response is never
	 * followed.
	 *
	 * @param string      $access_token Access token.
	 * @param string|null $after        Cursor of the page to read, null for the first.
	 * @return array Decoded response.
	 * @throws InstagramOAuthException ERROR_EXCHANGE_FAILED.
	 */
	public function assigned_instagram_accounts( $access_token, $after = null ) {
		$query = array(
			'fields'       => 'id,username',
			'limit'        => InstagramUnifiedLogin::ACCOUNTS_PAGE_SIZE,
			'access_token' => $access_token,
		);
		if ( null !== $after ) {
			$query['after'] = (string) $after;
		}

		return $this->get( '/me/assigned_instagram_accounts', $query );
	}

	/**
	 * Username of one Instagram account, '' when Meta reports none.
	 *
	 * @param string $access_token Access token.
	 * @param string $account_id   Instagram account ID (digits only).
	 * @return string Username as Meta returned it.
	 * @throws InstagramOAuthException ERROR_EXCHANGE_FAILED.
	 */
	public function account_username( $access_token, $account_id ) {
		if ( ! preg_match( '/^\d{1,32}$/', (string) $account_id ) ) {
			throw new InstagramOAuthException( InstagramUnifiedLogin::ERROR_EXCHANGE_FAILED );
		}

		$body = $this->get(
			'/' . $account_id,
			array(
				'fields'       => 'username',
				'access_token' => $access_token,
			)
		);

		return isset( $body['username'] ) && is_string( $body['username'] ) ? $body['username'] : '';
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
