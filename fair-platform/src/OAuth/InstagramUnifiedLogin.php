<?php
/**
 * Instagram API with Unified Login: request and response rules
 *
 * @package FairPlatform
 */

namespace FairPlatform\OAuth;

defined( 'ABSPATH' ) || die;

// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped -- exceptions carry fixed InstagramUnifiedLogin::ERROR_* codes and are never printed.

/**
 * Side-effect-free rules of the Instagram connection through Meta's Unified
 * Login (Facebook Login for Business with a configuration ID).
 *
 * The flow, verified against a development-mode authorization (#2427):
 *
 * 1. The site's server creates a verifier and sends its SHA-256 challenge,
 *    its own address and an exact return destination to
 *    `/oauth/instagram/authorize`.
 * 2. This platform stores that attempt under a random, single-use state and
 *    sends the administrator to Meta's login dialog with the configuration.
 * 3. Meta returns a code to `/oauth/instagram/callback`. The platform
 *    consumes the state first, exchanges the code, checks the token with
 *    `debug_token`, and finds the one Instagram account the business shared
 *    through `/me/assigned_instagram_accounts`.
 * 4. The credentials are stored encrypted under a short-lived, single-use
 *    handoff code. Only that code goes back to the site, in the return URL.
 * 5. The site's server redeems the code with its verifier
 *    (`POST /wp-json/fair-platform/v1/instagram/redeem`). The access token
 *    never appears in a URL or a browser response.
 *
 * The configuration issues a business integration system-user token that
 * does not expire (`expires_at` 0). There is no renewal: the token stops
 * working when the business removes the app in Meta Business Settings.
 */
class InstagramUnifiedLogin {

	/**
	 * Graph API version used when META_GRAPH_VERSION is not set.
	 */
	const DEFAULT_GRAPH_VERSION = 'v27.0';

	/**
	 * Permissions the token must carry to identify and publish to the account.
	 */
	const REQUIRED_SCOPES = array( 'instagram_basic', 'instagram_content_publish' );

	/**
	 * Token types this flow accepts, as `debug_token` reports them.
	 */
	const TOKEN_TYPES = array(
		'SYSTEM_USER' => 'system_user',
		'USER'        => 'user',
	);

	/**
	 * Version of the site ↔ platform protocol. Sites that do not send it use
	 * the retired Instagram Login flow and must be updated.
	 */
	const PROTOCOL = '2';

	/**
	 * Seconds an authorization attempt (the state) stays valid.
	 */
	const STATE_TTL = 600;

	/**
	 * Seconds a handoff code stays redeemable.
	 */
	const HANDOFF_TTL = 300;

	/**
	 * Admin page a return destination must point to.
	 */
	const RETURN_PAGE = 'fair-events-instagram';

	/**
	 * Failure codes, returned to the site as `instagram_error`.
	 */
	const ERROR_CANCELLED                = 'cancelled';
	const ERROR_AUTHORIZATION_FAILED     = 'authorization_failed';
	const ERROR_EXCHANGE_FAILED          = 'exchange_failed';
	const ERROR_INSUFFICIENT_PERMISSIONS = 'insufficient_permissions';
	const ERROR_NO_ACCOUNT               = 'no_account';
	const ERROR_MULTIPLE_ACCOUNTS        = 'multiple_accounts';
	const ERROR_SERVER                   = 'server_error';

	/**
	 * Failure codes of the authorize request, answered on the platform's own
	 * page because the return destination is not trusted yet.
	 */
	const ERROR_CLIENT_OUTDATED = 'client_outdated';
	const ERROR_INVALID_REQUEST = 'invalid_request';

	/**
	 * Unified Login configuration from wp-config.php constants.
	 *
	 * @return array{app_id: string, app_secret: string, config_id: string, graph_version: string}|null Null when incomplete.
	 */
	public static function config() {
		$values = array();
		foreach ( array(
			'app_id'     => 'META_APP_ID',
			'app_secret' => 'META_APP_SECRET',
			'config_id'  => 'META_INSTAGRAM_CONFIG_ID',
		) as $key => $constant ) {
			$value = defined( $constant ) ? constant( $constant ) : '';
			if ( ! is_string( $value ) || '' === trim( $value ) ) {
				return null;
			}
			$values[ $key ] = trim( $value );
		}

		$version = defined( 'META_GRAPH_VERSION' ) ? constant( 'META_GRAPH_VERSION' ) : self::DEFAULT_GRAPH_VERSION;
		if ( ! is_string( $version ) || ! self::is_graph_version( $version ) ) {
			return null;
		}
		$values['graph_version'] = $version;

		return $values;
	}

	/**
	 * Whether a value is a Graph API version such as `v27.0`.
	 *
	 * @param string $version Version.
	 * @return bool
	 */
	public static function is_graph_version( $version ) {
		return (bool) preg_match( '/^v\d{1,3}\.\d{1,3}$/', (string) $version );
	}

	/**
	 * Meta login dialog for the configuration.
	 *
	 * @param array  $config       From config().
	 * @param string $redirect_uri This platform's callback URL.
	 * @param string $state        Single-use state.
	 * @return string
	 */
	public static function authorize_url( array $config, $redirect_uri, $state ) {
		return 'https://www.facebook.com/' . $config['graph_version'] . '/dialog/oauth?' . http_build_query(
			array(
				'client_id'                      => $config['app_id'],
				'redirect_uri'                   => $redirect_uri,
				'config_id'                      => $config['config_id'],
				// Business integration system-user tokens need the code grant.
				'response_type'                  => 'code',
				'override_default_response_type' => 'true',
				'state'                          => $state,
			),
			'',
			'&',
			PHP_QUERY_RFC3986
		);
	}

	/**
	 * Validate an authorize request from a site.
	 *
	 * @param array $params Unslashed query parameters.
	 * @return array{site_url: string, return_url: string, code_challenge: string, client_state: string, site_name: string} Attempt to store.
	 * @throws InstagramOAuthException ERROR_CLIENT_OUTDATED or ERROR_INVALID_REQUEST.
	 */
	public static function validate_authorize_request( array $params ) {
		if ( ! isset( $params['protocol'] ) || self::PROTOCOL !== $params['protocol'] ) {
			throw new InstagramOAuthException( self::ERROR_CLIENT_OUTDATED );
		}

		$site_url       = self::string_param( $params, 'site_url' );
		$return_url     = self::string_param( $params, 'return_url' );
		$code_challenge = self::string_param( $params, 'code_challenge' );
		$client_state   = self::string_param( $params, 'state' );

		if (
			! self::is_code_challenge( $code_challenge )
			|| ! self::is_client_state( $client_state )
			|| ! self::is_approved_return_url( $return_url, $site_url )
		) {
			throw new InstagramOAuthException( self::ERROR_INVALID_REQUEST );
		}

		$site_name = preg_replace( '/[\x00-\x1F\x7F]/', '', self::string_param( $params, 'site_name' ) );

		return array(
			'site_url'       => self::normalize_site_url( $site_url ),
			'return_url'     => $return_url,
			'code_challenge' => $code_challenge,
			'client_state'   => $client_state,
			'site_name'      => function_exists( 'mb_substr' ) ? mb_substr( (string) $site_name, 0, 200 ) : substr( (string) $site_name, 0, 200 ),
		);
	}

	/**
	 * Whether a return destination is the Fair Events → Instagram page of the
	 * site that started the attempt, and nothing else.
	 *
	 * HTTPS only, except plain HTTP on localhost for development. No
	 * credentials, fragment or extra parameters; same host and port as the
	 * site; the path is the site's `wp-admin/admin.php`.
	 *
	 * @param string $return_url Return destination.
	 * @param string $site_url   The site's address (`site_url()`).
	 * @return bool
	 */
	public static function is_approved_return_url( $return_url, $site_url ) {
		if ( ! is_string( $return_url ) || ! is_string( $site_url ) || strlen( $return_url ) > 2048 || preg_match( '/[\s\x00-\x1F\x7F\\\\]/', $return_url . $site_url ) ) {
			return false;
		}

		$return = parse_url( $return_url ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- strict component check, no WordPress normalization.
		$site   = parse_url( $site_url ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url
		if ( ! is_array( $return ) || ! is_array( $site ) ) {
			return false;
		}

		foreach ( array( $return, $site ) as $parts ) {
			if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['pass'] ) || isset( $parts['fragment'] ) ) {
				return false;
			}
		}

		$scheme = strtolower( $return['scheme'] );
		$host   = strtolower( $return['host'] );
		$local  = in_array( $host, array( 'localhost', '127.0.0.1' ), true );
		if ( 'https' !== $scheme && ! ( 'http' === $scheme && $local ) ) {
			return false;
		}

		if (
			strtolower( $site['scheme'] ) !== $scheme
			|| strtolower( $site['host'] ) !== $host
			|| ( $site['port'] ?? null ) !== ( $return['port'] ?? null )
			|| isset( $site['query'] )
		) {
			return false;
		}

		$site_path = rtrim( $site['path'] ?? '', '/' );
		if ( ( $return['path'] ?? '' ) !== $site_path . '/wp-admin/admin.php' ) {
			return false;
		}

		return ( $return['query'] ?? '' ) === 'page=' . self::RETURN_PAGE;
	}

	/**
	 * A site address without a trailing slash, so it compares exactly.
	 *
	 * @param string $site_url Site address.
	 * @return string
	 */
	public static function normalize_site_url( $site_url ) {
		return rtrim( (string) $site_url, '/' );
	}

	/**
	 * Whether a value is an S256 challenge: base64url of 32 bytes.
	 *
	 * @param string $value Value.
	 * @return bool
	 */
	public static function is_code_challenge( $value ) {
		return is_string( $value ) && (bool) preg_match( '/^[A-Za-z0-9_-]{43}$/', $value );
	}

	/**
	 * Whether a value is a verifier: 43 to 128 unreserved characters.
	 *
	 * @param string $value Value.
	 * @return bool
	 */
	public static function is_code_verifier( $value ) {
		return is_string( $value ) && (bool) preg_match( '/^[A-Za-z0-9._~-]{43,128}$/', $value );
	}

	/**
	 * Whether a value can be the site's own attempt identifier.
	 *
	 * @param string $value Value.
	 * @return bool
	 */
	public static function is_client_state( $value ) {
		return is_string( $value ) && (bool) preg_match( '/^[A-Za-z0-9_-]{16,128}$/', $value );
	}

	/**
	 * Whether a value can be a store key issued by OneTimeStore.
	 *
	 * @param string $value Value.
	 * @return bool
	 */
	public static function is_store_key( $value ) {
		return is_string( $value ) && (bool) preg_match( '/^[A-Za-z0-9_-]{43}$/', $value );
	}

	/**
	 * S256 challenge of a verifier.
	 *
	 * @param string $verifier Verifier.
	 * @return string
	 */
	public static function code_challenge( $verifier ) {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- base64url of a hash, per RFC 7636.
		return rtrim( strtr( base64_encode( hash( 'sha256', (string) $verifier, true ) ), '+/', '-_' ), '=' );
	}

	/**
	 * Whether a verifier belongs to a stored challenge, in constant time.
	 *
	 * @param string $verifier  Verifier the site sent.
	 * @param string $challenge Challenge stored with the attempt.
	 * @return bool
	 */
	public static function verifier_matches( $verifier, $challenge ) {
		return self::is_code_verifier( $verifier )
			&& self::is_code_challenge( $challenge )
			&& hash_equals( $challenge, self::code_challenge( $verifier ) );
	}

	/**
	 * Failure code for an error Meta returned to the callback.
	 *
	 * @param string $error        Meta `error`.
	 * @param string $error_reason Meta `error_reason`.
	 * @return string
	 */
	public static function callback_error( $error, $error_reason ) {
		return 'access_denied' === $error || 'user_denied' === $error_reason
			? self::ERROR_CANCELLED
			: self::ERROR_AUTHORIZATION_FAILED;
	}

	/**
	 * Return URL carrying a failure code back to the site.
	 *
	 * @param array  $attempt Stored attempt.
	 * @param string $reason  Failure code.
	 * @return string
	 */
	public static function error_redirect_url( array $attempt, $reason ) {
		return self::append_query(
			$attempt['return_url'],
			array(
				'instagram_error' => $reason,
				'state'           => $attempt['client_state'],
			)
		);
	}

	/**
	 * Return URL carrying the handoff code back to the site.
	 *
	 * @param array  $attempt Stored attempt.
	 * @param string $handoff Handoff code.
	 * @return string
	 */
	public static function success_redirect_url( array $attempt, $handoff ) {
		return self::append_query(
			$attempt['return_url'],
			array(
				'instagram_handoff' => $handoff,
				'state'             => $attempt['client_state'],
			)
		);
	}

	/**
	 * Check a token with what `debug_token` reported about it.
	 *
	 * @param mixed  $response Decoded `debug_token` response.
	 * @param string $app_id   This platform's Meta app ID.
	 * @return array{token_type: string, scopes: string[], expires_at: int|null} Expiry null when the token does not expire.
	 * @throws InstagramOAuthException ERROR_EXCHANGE_FAILED or ERROR_INSUFFICIENT_PERMISSIONS.
	 */
	public static function evaluate_token( $response, $app_id ) {
		$data = is_array( $response ) && isset( $response['data'] ) && is_array( $response['data'] ) ? $response['data'] : null;

		if (
			null === $data
			|| true !== ( $data['is_valid'] ?? null )
			|| (string) ( $data['app_id'] ?? '' ) !== (string) $app_id
			|| ! isset( $data['type'] ) || ! isset( self::TOKEN_TYPES[ $data['type'] ] )
		) {
			throw new InstagramOAuthException( self::ERROR_EXCHANGE_FAILED );
		}

		$scopes = array_values( array_filter( isset( $data['scopes'] ) && is_array( $data['scopes'] ) ? $data['scopes'] : array(), 'is_string' ) );
		if ( array_diff( self::REQUIRED_SCOPES, $scopes ) ) {
			throw new InstagramOAuthException( self::ERROR_INSUFFICIENT_PERMISSIONS );
		}

		$expires_at = isset( $data['expires_at'] ) && is_int( $data['expires_at'] ) ? $data['expires_at'] : null;
		if ( null === $expires_at ) {
			throw new InstagramOAuthException( self::ERROR_EXCHANGE_FAILED );
		}

		return array(
			'token_type' => self::TOKEN_TYPES[ $data['type'] ],
			'scopes'     => $scopes,
			// Meta reports 0 for a token that does not expire.
			'expires_at' => $expires_at > 0 ? $expires_at : null,
		);
	}

	/**
	 * The one Instagram account the business shared.
	 *
	 * @param mixed $response Decoded `/me/assigned_instagram_accounts` response.
	 * @return array{id: string, username: string}
	 * @throws InstagramOAuthException ERROR_EXCHANGE_FAILED, ERROR_NO_ACCOUNT or ERROR_MULTIPLE_ACCOUNTS.
	 */
	public static function select_account( $response ) {
		if ( ! is_array( $response ) || ! isset( $response['data'] ) || ! is_array( $response['data'] ) ) {
			throw new InstagramOAuthException( self::ERROR_EXCHANGE_FAILED );
		}

		$accounts = array();
		foreach ( $response['data'] as $account ) {
			if ( is_array( $account ) && isset( $account['id'] ) && preg_match( '/^\d{1,32}$/', (string) $account['id'] ) ) {
				$accounts[] = array(
					'id'       => (string) $account['id'],
					'username' => isset( $account['username'] ) && is_string( $account['username'] ) ? self::clean_username( $account['username'] ) : '',
				);
			}
		}

		// A further page means more than the accounts listed here.
		$more = ! empty( $response['paging']['next'] );

		if ( 0 === count( $accounts ) && ! $more ) {
			throw new InstagramOAuthException( self::ERROR_NO_ACCOUNT );
		}
		if ( 1 !== count( $accounts ) || $more ) {
			throw new InstagramOAuthException( self::ERROR_MULTIPLE_ACCOUNTS );
		}

		return $accounts[0];
	}

	/**
	 * What is stored under the handoff code.
	 *
	 * @param string $access_token Access token.
	 * @param array  $token        From evaluate_token().
	 * @param array  $account      From select_account().
	 * @param array  $attempt      Stored attempt.
	 * @param string $graph_version Graph API version the token was checked with.
	 * @return array<string,mixed>
	 */
	public static function handoff_payload( $access_token, array $token, array $account, array $attempt, $graph_version ) {
		return array(
			'access_token'   => (string) $access_token,
			'token_type'     => $token['token_type'],
			'scopes'         => $token['scopes'],
			'expires_at'     => $token['expires_at'],
			'account_id'     => $account['id'],
			'username'       => $account['username'],
			'graph_version'  => $graph_version,
			'site_url'       => $attempt['site_url'],
			'code_challenge' => $attempt['code_challenge'],
		);
	}

	/**
	 * Check a redemption against the stored handoff.
	 *
	 * @param mixed  $payload  Stored handoff payload, or null when unknown, used or expired.
	 * @param string $verifier Verifier the site sent.
	 * @param string $site_url Site address the site sent.
	 * @return array<string,mixed> Credentials for the site.
	 * @throws InstagramOAuthException ERROR_INVALID_REQUEST.
	 */
	public static function redemption( $payload, $verifier, $site_url ) {
		if (
			! is_array( $payload )
			|| ! isset( $payload['code_challenge'], $payload['site_url'], $payload['access_token'] )
			|| ! self::verifier_matches( $verifier, $payload['code_challenge'] )
			|| ! is_string( $site_url )
			|| ! hash_equals( (string) $payload['site_url'], self::normalize_site_url( $site_url ) )
		) {
			throw new InstagramOAuthException( self::ERROR_INVALID_REQUEST );
		}

		return array(
			'access_token'  => $payload['access_token'],
			'token_type'    => $payload['token_type'],
			'scopes'        => $payload['scopes'],
			'expires_at'    => $payload['expires_at'],
			'account_id'    => $payload['account_id'],
			'username'      => $payload['username'],
			'graph_version' => $payload['graph_version'],
		);
	}

	/**
	 * A username without control characters or a leading @.
	 *
	 * @param string $username Username.
	 * @return string
	 */
	private static function clean_username( $username ) {
		return substr( (string) preg_replace( '/[^A-Za-z0-9._]/', '', $username ), 0, 64 );
	}

	/**
	 * A string query parameter, or ''.
	 *
	 * @param array  $params Parameters.
	 * @param string $key    Key.
	 * @return string
	 */
	private static function string_param( array $params, $key ) {
		return isset( $params[ $key ] ) && is_string( $params[ $key ] ) ? $params[ $key ] : '';
	}

	/**
	 * Append encoded query parameters to a URL that has a query already.
	 *
	 * @param string $url  URL.
	 * @param array  $args Parameters.
	 * @return string
	 */
	private static function append_query( $url, array $args ) {
		return $url . ( false === strpos( $url, '?' ) ? '?' : '&' ) . http_build_query( $args, '', '&', PHP_QUERY_RFC3986 );
	}
}
