<?php
/**
 * Instagram connection for Fair Events Experimental
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Instagram;

use FairEventsShared\Security\ProtectedOptions;
use FairEventsShared\Security\SecretReadResult;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * The connected Instagram account: its access token, encrypted at rest
 * through the shared ProtectedOptions mechanism, and what is known about it.
 *
 * Connections are made through Meta's Unified Login (#2427): the token is a
 * business integration system-user token that does not expire, and it
 * publishes through graph.facebook.com to the Instagram account the business
 * shared. Connections stored before that, through Instagram Login, carry no
 * connection-format marker. They stay stored but cannot be used to test,
 * publish or renew until the administrator connects again.
 *
 * The options keep the names Fair Audience gave them, so the connection can
 * move between the plugins (see {@see Ownership}). The token never leaves
 * the server: nothing here returns it to a browser or writes it to a log or
 * error message.
 *
 * A stored token that cannot be decrypted never clears the connection: the
 * value stays in storage, and Instagram is reported unavailable until
 * encryption support returns, or until the administrator reconnects when the
 * value is unrecoverable. Disconnecting removes it.
 */
class Connection {

	const TOKEN_OPTION      = 'fair_audience_instagram_access_token';
	const USER_ID_OPTION    = 'fair_audience_instagram_user_id';
	const USERNAME_OPTION   = 'fair_audience_instagram_username';
	const CONNECTED_OPTION  = 'fair_audience_instagram_connected';
	const EXPIRES_OPTION    = 'fair_audience_instagram_token_expires';
	const CONVERSION_OPTION = 'fair_audience_instagram_credentials_converted';

	/**
	 * Connection metadata written with every Unified Login connection.
	 * FORMAT_OPTION is written last: a connection without it is never used.
	 */
	const FORMAT_OPTION        = 'fair_audience_instagram_connection_format';
	const TOKEN_TYPE_OPTION    = 'fair_audience_instagram_token_type';
	const SCOPES_OPTION        = 'fair_audience_instagram_scopes';
	const EXPIRY_OPTION        = 'fair_audience_instagram_token_expiry';
	const GRAPH_VERSION_OPTION = 'fair_audience_instagram_graph_version';

	/**
	 * Format marker of a Unified Login connection.
	 */
	const FORMAT_UNIFIED_LOGIN = 'unified_login';

	/**
	 * Token expiry kinds: confirmed not to expire, or expiring at
	 * EXPIRES_OPTION.
	 */
	const EXPIRY_NEVER   = 'never';
	const EXPIRY_EXPIRES = 'expires';

	/**
	 * Stored in EXPIRES_OPTION for a token that does not expire (2100-01-01),
	 * so releases older than #2427 that still renew tokens near expiry leave
	 * it alone. EXPIRY_OPTION is what this plugin reads.
	 */
	const NEVER_EXPIRES_SENTINEL = 4102444800;

	/**
	 * Permissions a connection needs to identify and publish to the account.
	 */
	const REQUIRED_SCOPES = array( 'instagram_basic', 'instagram_content_publish' );

	/**
	 * Token types Unified Login issues.
	 */
	const TOKEN_TYPES = array( 'system_user', 'user' );

	/**
	 * Graph API version used when a connection names none.
	 */
	const DEFAULT_GRAPH_VERSION = 'v27.0';

	const AVAILABLE              = 'available';
	const ENCRYPTION_UNAVAILABLE = 'encryption_unavailable';
	const UNRECOVERABLE          = 'unrecoverable';
	// A connection stored before #2427 (Instagram Login).
	const RECONNECT_REQUIRED = 'reconnect_required';
	// A connection whose token's finite expiry has passed.
	const EXPIRED = 'expired';

	/**
	 * Daily token refresh of earlier releases, retired with Instagram Login.
	 * Kept so its leftover events are removed.
	 */
	const REFRESH_HOOK = 'fair_events_experimental_instagram_token_refresh';

	/**
	 * Graph API host of the Instagram API with Unified Login.
	 */
	const GRAPH_URL = 'https://graph.facebook.com';

	/**
	 * Protect the token and convert one stored before encryption existed.
	 * Runs only while this plugin owns the connection.
	 *
	 * @return void
	 */
	public static function boot() {
		ProtectedOptions::protect( self::TOKEN_OPTION );
		add_action( 'init', array( self::class, 'maybe_convert' ) );
	}

	/**
	 * Encrypt a token stored as plaintext, once. The marker is shared with
	 * Fair Audience, which did the same before.
	 *
	 * @return void
	 */
	public static function maybe_convert() {
		if ( get_option( self::CONVERSION_OPTION ) ) {
			return;
		}

		$done = array( ProtectedOptions::CONVERTED, ProtectedOptions::ENCRYPTED, ProtectedOptions::EMPTY_VALUE, ProtectedOptions::CHANGED );

		if ( in_array( ProtectedOptions::convert( self::TOKEN_OPTION ), $done, true ) ) {
			update_option( self::CONVERSION_OPTION, 1 );
		}
	}

	/**
	 * Whether the stored token can be read.
	 *
	 * @return string One of AVAILABLE, ENCRYPTION_UNAVAILABLE, UNRECOVERABLE.
	 */
	private static function storage_status() {
		switch ( ProtectedOptions::read( self::TOKEN_OPTION )->status() ) {
			case SecretReadResult::UNRECOVERABLE:
				return self::UNRECOVERABLE;
			case SecretReadResult::UNSUPPORTED:
				return self::ENCRYPTION_UNAVAILABLE;
			default:
				return self::AVAILABLE;
		}
	}

	/**
	 * Whether the stored token can be used.
	 *
	 * @return string One of AVAILABLE, ENCRYPTION_UNAVAILABLE, UNRECOVERABLE,
	 *                RECONNECT_REQUIRED, EXPIRED.
	 */
	public static function status() {
		$storage = self::storage_status();
		if ( self::AVAILABLE !== $storage ) {
			return $storage;
		}

		$stored = get_option( self::TOKEN_OPTION, '' );
		// No token: nothing to reconnect, the site is simply not connected.
		if ( ! is_string( $stored ) || '' === $stored ) {
			return self::AVAILABLE;
		}

		if ( ! self::is_unified() ) {
			return self::RECONNECT_REQUIRED;
		}

		if ( self::EXPIRY_EXPIRES === get_option( self::EXPIRY_OPTION, '' ) && (int) get_option( self::EXPIRES_OPTION, 0 ) <= time() ) {
			return self::EXPIRED;
		}

		return self::AVAILABLE;
	}

	/**
	 * Whether the stored connection was made through Unified Login.
	 *
	 * @return bool
	 */
	public static function is_unified() {
		return self::FORMAT_UNIFIED_LOGIN === get_option( self::FORMAT_OPTION, '' );
	}

	/**
	 * Whether Instagram is connected and its token can be used.
	 *
	 * @return bool
	 */
	public static function is_connected() {
		return (bool) get_option( self::CONNECTED_OPTION, false )
			&& self::AVAILABLE === self::status()
			&& '' !== self::access_token()
			&& '' !== self::user_id();
	}

	/**
	 * The usable access token, or '' when there is none.
	 *
	 * @return string
	 */
	public static function access_token() {
		if ( self::AVAILABLE !== self::status() ) {
			return '';
		}
		$token = get_option( self::TOKEN_OPTION, '' );
		return is_string( $token ) ? $token : '';
	}

	/**
	 * The connected Instagram account's ID, or ''.
	 *
	 * @return string
	 */
	public static function user_id() {
		return (string) get_option( self::USER_ID_OPTION, '' );
	}

	/**
	 * Graph API base URL for this connection, with its version.
	 *
	 * @return string
	 */
	public static function graph_base() {
		$version = (string) get_option( self::GRAPH_VERSION_OPTION, '' );
		if ( ! preg_match( '/^v\d{1,3}\.\d{1,3}$/', $version ) ) {
			$version = self::DEFAULT_GRAPH_VERSION;
		}
		return self::GRAPH_URL . '/' . $version;
	}

	/**
	 * Why the connection cannot be used to publish, or null when it can.
	 *
	 * @return WP_Error|null
	 */
	public static function unavailable_reason() {
		$status = self::status();
		if ( self::AVAILABLE !== $status ) {
			return new WP_Error( 'instagram_credentials_unavailable', self::admin_message( $status ) );
		}
		if ( ! get_option( self::CONNECTED_OPTION, false ) || '' === self::access_token() || '' === self::user_id() ) {
			return new WP_Error(
				'instagram_not_connected',
				__( 'Instagram is not connected. Connect an account in Fair Events → Instagram.', 'fair-events-experimental' )
			);
		}
		return null;
	}

	/**
	 * Administrator-facing explanation of an unavailable status.
	 *
	 * @param string $status Status from status().
	 * @return string Empty for AVAILABLE.
	 */
	public static function admin_message( $status ) {
		switch ( $status ) {
			case self::ENCRYPTION_UNAVAILABLE:
				return __( 'Instagram is paused: the access token is stored encrypted, but this server no longer provides the Sodium encryption support needed to read it. Ask your host to restore PHP Sodium support; Instagram then resumes without reconnecting.', 'fair-events-experimental' );
			case self::UNRECOVERABLE:
				return __( 'Instagram needs to be reconnected: the stored access token can no longer be read. This happens when the site’s security keys change or the database is moved to another site. Connect with Instagram again.', 'fair-events-experimental' );
			case self::RECONNECT_REQUIRED:
				return __( 'Instagram needs to be reconnected: Meta replaced the way sites connect to Instagram, and this connection was made the old way. Connect with Instagram again. Posts already published, and their records on this site, are kept.', 'fair-events-experimental' );
			case self::EXPIRED:
				return __( 'Instagram needs to be reconnected: the access token has expired. Connect with Instagram again.', 'fair-events-experimental' );
			default:
				return '';
		}
	}

	/**
	 * Connection details for administrators. Never includes the token.
	 *
	 * @return array<string,mixed>
	 */
	public static function details() {
		$status  = self::status();
		$raw     = ProtectedOptions::raw( self::TOKEN_OPTION );
		$unified = self::is_unified();
		$expiry  = $unified ? (string) get_option( self::EXPIRY_OPTION, '' ) : '';
		$expires = (int) get_option( self::EXPIRES_OPTION, 0 );
		$scopes  = $unified ? get_option( self::SCOPES_OPTION, array() ) : array();

		return array(
			'connected'             => (bool) get_option( self::CONNECTED_OPTION, false ),
			'usable'                => self::is_connected(),
			'credential_status'     => $status,
			'credentials_encrypted' => is_string( $raw ) && '' !== $raw && ProtectedOptions::read( self::TOKEN_OPTION )->is_encrypted(),
			'message'               => self::admin_message( $status ),
			'user_id'               => self::user_id(),
			'username'              => (string) get_option( self::USERNAME_OPTION, '' ),
			'connection_format'     => $unified ? self::FORMAT_UNIFIED_LOGIN : null,
			'token_type'            => $unified ? (string) get_option( self::TOKEN_TYPE_OPTION, '' ) : null,
			'scopes'                => is_array( $scopes ) ? array_values( array_filter( $scopes, 'is_string' ) ) : array(),
			// 'never', 'expires', or null when not known.
			'token_expiry'          => in_array( $expiry, array( self::EXPIRY_NEVER, self::EXPIRY_EXPIRES ), true ) ? $expiry : null,
			'token_expires'         => self::EXPIRY_EXPIRES === $expiry && $expires > 0 ? $expires : null,
		);
	}

	/**
	 * Check credentials redeemed from the OAuth service.
	 *
	 * @param mixed $credentials Decoded redemption response.
	 * @return array{access_token: string, token_type: string, scopes: string[], expires_at: int|null, account_id: string, username: string, graph_version: string}|WP_Error
	 */
	public static function validate_credentials( $credentials ) {
		$invalid = new WP_Error(
			'instagram_credentials_incomplete',
			__( 'The Instagram connection could not be completed: the OAuth service returned incomplete credentials. Nothing was changed; connect again.', 'fair-events-experimental' ),
			array( 'status' => 502 )
		);

		if ( ! is_array( $credentials ) ) {
			return $invalid;
		}

		$token   = $credentials['access_token'] ?? null;
		$type    = $credentials['token_type'] ?? null;
		$scopes  = $credentials['scopes'] ?? null;
		$expires = array_key_exists( 'expires_at', $credentials ) ? $credentials['expires_at'] : false;
		$account = $credentials['account_id'] ?? null;
		$version = $credentials['graph_version'] ?? null;

		if (
			! is_string( $token ) || '' === $token || strlen( $token ) > 2048 || preg_match( '/\s/', $token )
			|| ! is_string( $type ) || ! in_array( $type, self::TOKEN_TYPES, true )
			|| ! is_array( $scopes )
			|| ! ( null === $expires || is_int( $expires ) )
			|| ! is_string( $account ) || ! preg_match( '/^\d{1,32}$/', $account )
			|| ! is_string( $version ) || ! preg_match( '/^v\d{1,3}\.\d{1,3}$/', $version )
		) {
			return $invalid;
		}

		$scopes = array_values( array_filter( $scopes, 'is_string' ) );
		if ( array_diff( self::REQUIRED_SCOPES, $scopes ) ) {
			return new WP_Error(
				'instagram_permissions_missing',
				__( 'Meta did not grant permission to publish to Instagram. Nothing was changed; connect again and allow every requested permission.', 'fair-events-experimental' ),
				array( 'status' => 403 )
			);
		}

		if ( is_int( $expires ) && $expires <= time() ) {
			return $invalid;
		}

		$username = isset( $credentials['username'] ) && is_string( $credentials['username'] )
			? substr( (string) preg_replace( '/[^A-Za-z0-9._]/', '', $credentials['username'] ), 0, 64 )
			: '';

		return array(
			'access_token'  => $token,
			'token_type'    => $type,
			'scopes'        => $scopes,
			'expires_at'    => $expires,
			'account_id'    => $account,
			'username'      => $username,
			'graph_version' => $version,
		);
	}

	/**
	 * Store a Unified Login connection.
	 *
	 * The token is written first. When it cannot be stored encrypted, the
	 * previous credentials and their metadata stay exactly as they were, so
	 * a failed replacement never turns an old connection usable. Once it is
	 * stored, the format marker is cleared, the metadata written, and the
	 * marker set last.
	 *
	 * @param array $credentials From validate_credentials().
	 * @return true|WP_Error
	 */
	public static function connect( array $credentials ) {
		if ( ! ProtectedOptions::can_store( self::TOKEN_OPTION ) ) {
			return new WP_Error(
				'instagram_token_not_stored',
				self::admin_message( self::ENCRYPTION_UNAVAILABLE ),
				array( 'status' => 409 )
			);
		}

		// A token that can't be read compares as empty, so update_option()
		// would skip writing the same value: remove it first.
		if ( self::AVAILABLE !== self::storage_status() ) {
			delete_option( self::TOKEN_OPTION );
		}

		update_option( self::TOKEN_OPTION, $credentials['access_token'], false );

		if ( ProtectedOptions::last_write_failed( self::TOKEN_OPTION ) ) {
			return new WP_Error(
				'instagram_token_not_stored',
				__( 'The Instagram access token could not be stored encrypted, so the previous connection was kept. Try again.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		$never = null === $credentials['expires_at'];

		update_option( self::FORMAT_OPTION, '' );
		update_option( self::USER_ID_OPTION, $credentials['account_id'] );
		update_option( self::USERNAME_OPTION, $credentials['username'] );
		update_option( self::TOKEN_TYPE_OPTION, $credentials['token_type'] );
		update_option( self::SCOPES_OPTION, $credentials['scopes'] );
		update_option( self::GRAPH_VERSION_OPTION, $credentials['graph_version'] );
		update_option( self::EXPIRY_OPTION, $never ? self::EXPIRY_NEVER : self::EXPIRY_EXPIRES );
		update_option( self::EXPIRES_OPTION, $never ? self::NEVER_EXPIRES_SENTINEL : (int) $credentials['expires_at'] );
		update_option( self::CONNECTED_OPTION, true );
		update_option( self::FORMAT_OPTION, self::FORMAT_UNIFIED_LOGIN );

		return true;
	}

	/**
	 * Remove the token and every connection detail. Published posts and post
	 * records stay. Meta keeps the app connected to the business until the
	 * business removes it in Meta Business Settings.
	 *
	 * @return void
	 */
	public static function disconnect() {
		delete_option( self::TOKEN_OPTION );
		foreach ( array( self::FORMAT_OPTION, self::TOKEN_TYPE_OPTION, self::SCOPES_OPTION, self::EXPIRY_OPTION, self::GRAPH_VERSION_OPTION ) as $option ) {
			delete_option( $option );
		}
		update_option( self::USER_ID_OPTION, '' );
		update_option( self::USERNAME_OPTION, '' );
		update_option( self::EXPIRES_OPTION, 0 );
		update_option( self::CONNECTED_OPTION, false );
	}

	/**
	 * Check the token with Meta and refresh the account's username.
	 *
	 * @return array<string,mixed>|WP_Error Account details, or why the check failed.
	 */
	public static function test() {
		$status = self::status();
		if ( self::AVAILABLE !== $status ) {
			return new WP_Error(
				'instagram_credentials_unavailable',
				self::admin_message( $status ),
				array(
					'status'            => 409,
					'credential_status' => $status,
				)
			);
		}

		$token   = self::access_token();
		$account = self::user_id();
		if ( '' === $token || '' === $account ) {
			return new WP_Error(
				'instagram_not_connected',
				__( 'Instagram is not connected. Connect with Instagram first.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}

		$response = wp_remote_get(
			self::graph_base() . '/' . rawurlencode( $account ) . '?fields=id,username',
			array(
				'timeout'     => 30,
				'redirection' => 0,
				'headers'     => array( 'Authorization' => 'Bearer ' . $token ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'instagram_unreachable',
				__( 'Instagram could not be reached. Check the server’s internet connection and try again.', 'fair-events-experimental' ),
				array( 'status' => 502 )
			);
		}

		$data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$data = is_array( $data ) ? $data : array();

		if ( isset( $data['error'] ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			$detail = isset( $data['error']['message'] ) && is_string( $data['error']['message'] )
				? self::redact( $data['error']['message'], $token )
				: '';
			$code   = isset( $data['error']['code'] ) ? (int) $data['error']['code'] : 0;

			return 190 === $code
				? new WP_Error(
					'instagram_token_invalid',
					__( 'Meta refused the access token: it was revoked, or the business removed this app in Meta Business Settings. Connect with Instagram again.', 'fair-events-experimental' ),
					array(
						'status'  => 401,
						'details' => $detail,
					)
				)
				: new WP_Error(
					'instagram_account_unavailable',
					__( 'Meta did not let this site read the connected Instagram account. Its access may have been removed. Connect with Instagram again and share the account.', 'fair-events-experimental' ),
					array(
						'status'  => 403,
						'details' => $detail,
					)
				);
		}

		if ( ! isset( $data['id'] ) || (string) $data['id'] !== $account ) {
			return new WP_Error(
				'instagram_account_mismatch',
				__( 'Meta answered for a different Instagram account than the one connected. Connect with Instagram again.', 'fair-events-experimental' ),
				array( 'status' => 502 )
			);
		}

		$username = isset( $data['username'] ) && is_string( $data['username'] )
			? substr( (string) preg_replace( '/[^A-Za-z0-9._]/', '', $data['username'] ), 0, 64 )
			: '';
		if ( '' !== $username ) {
			update_option( self::USERNAME_OPTION, $username );
		}

		return array(
			'success' => true,
			'message' => '' !== $username
				? sprintf(
					/* translators: %s: Instagram username */
					__( 'The connection works: Meta confirmed the account @%s.', 'fair-events-experimental' ),
					$username
				)
				: __( 'The connection works.', 'fair-events-experimental' ),
		) + self::details();
	}

	/**
	 * Remove the token from a message received from Meta.
	 *
	 * @param string $message Message.
	 * @param string $token   Access token.
	 * @return string
	 */
	public static function redact( $message, $token ) {
		$message = '' !== $token ? str_replace( $token, '[redacted]', $message ) : $message;
		return (string) preg_replace( '/access_token=[^&\s"]+/', 'access_token=[redacted]', $message );
	}
}
