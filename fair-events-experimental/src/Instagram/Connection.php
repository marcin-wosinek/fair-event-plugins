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
 * through the shared ProtectedOptions mechanism, and the account details
 * shown to administrators.
 *
 * The options keep the names Fair Audience gave them, so a site connected
 * there keeps its connection when this plugin takes it over (see
 * {@see Ownership}). The token never leaves the server: nothing here returns
 * it to a browser or writes it to a log or error message.
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

	const AVAILABLE              = 'available';
	const ENCRYPTION_UNAVAILABLE = 'encryption_unavailable';
	const UNRECOVERABLE          = 'unrecoverable';

	/**
	 * Daily token refresh.
	 */
	const REFRESH_HOOK = 'fair_events_experimental_instagram_token_refresh';

	/**
	 * Token lifetime assumed when the refresh response names none (60 days).
	 */
	const DEFAULT_LIFETIME = 5184000;

	/**
	 * Refresh once the token expires within this many seconds.
	 */
	const REFRESH_WINDOW = 604800;

	/**
	 * Graph API base for the Instagram API with Instagram Login.
	 */
	const GRAPH_URL = 'https://graph.instagram.com';

	/**
	 * OAuth proxy refresh endpoint (fair-platform on fair-event-plugins.com).
	 */
	const REFRESH_URL = 'https://fair-event-plugins.com/oauth/instagram/refresh';

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
	 * Whether the stored token can be used.
	 *
	 * @return string One of AVAILABLE, ENCRYPTION_UNAVAILABLE, UNRECOVERABLE.
	 */
	public static function status() {
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
	 * Whether Instagram is connected and its token can be used.
	 *
	 * @return bool
	 */
	public static function is_connected() {
		return (bool) get_option( self::CONNECTED_OPTION, false )
			&& self::AVAILABLE === self::status()
			&& '' !== self::access_token();
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
	 * The connected account's Instagram user ID, or ''.
	 *
	 * @return string
	 */
	public static function user_id() {
		return (string) get_option( self::USER_ID_OPTION, '' );
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
		if ( ! get_option( self::CONNECTED_OPTION, false ) || '' === self::access_token() ) {
			return new WP_Error(
				'instagram_not_connected',
				__( 'Instagram is not connected. Connect an account in Fair Events → Instagram.', 'fair-events-experimental' )
			);
		}
		if ( '' === self::user_id() ) {
			return new WP_Error(
				'instagram_user_id_missing',
				__( 'The Instagram user ID is missing. Test the connection, or enter the user ID, in Fair Events → Instagram.', 'fair-events-experimental' )
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
		if ( self::ENCRYPTION_UNAVAILABLE === $status ) {
			return __( 'Instagram is paused: the access token is stored encrypted, but this server no longer provides the Sodium encryption support needed to read it. Ask your host to restore PHP Sodium support; Instagram then resumes without reconnecting.', 'fair-events-experimental' );
		}

		if ( self::UNRECOVERABLE === $status ) {
			return __( 'Instagram needs to be reconnected: the stored access token can no longer be read. This happens when the site’s security keys change or the database is moved to another site. Connect with Instagram or enter a new access token.', 'fair-events-experimental' );
		}

		return '';
	}

	/**
	 * Connection details for administrators. Never includes the token.
	 *
	 * @return array<string,mixed>
	 */
	public static function details() {
		$status  = self::status();
		$raw     = ProtectedOptions::raw( self::TOKEN_OPTION );
		$expires = (int) get_option( self::EXPIRES_OPTION, 0 );

		return array(
			'connected'             => (bool) get_option( self::CONNECTED_OPTION, false ),
			'usable'                => self::is_connected(),
			'credential_status'     => $status,
			'credentials_encrypted' => is_string( $raw ) && '' !== $raw && ProtectedOptions::read( self::TOKEN_OPTION )->is_encrypted(),
			'message'               => self::admin_message( $status ),
			'user_id'               => self::user_id(),
			'username'              => (string) get_option( self::USERNAME_OPTION, '' ),
			'token_expires'         => $expires > 0 ? $expires : null,
		);
	}

	/**
	 * Store a new access token and the account it belongs to.
	 *
	 * @param string   $token      Access token.
	 * @param string   $user_id    Instagram user ID, '' when unknown.
	 * @param string   $username   Instagram username, '' when unknown.
	 * @param int|null $expires_in Seconds until the token expires, null when unknown.
	 * @return true|WP_Error
	 */
	public static function connect( $token, $user_id = '', $username = '', $expires_in = null ) {
		if ( ! ProtectedOptions::can_store( self::TOKEN_OPTION ) ) {
			return new WP_Error(
				'instagram_token_not_stored',
				self::admin_message( self::ENCRYPTION_UNAVAILABLE ),
				array( 'status' => 409 )
			);
		}

		// A token that can't be read compares as empty, so update_option()
		// would skip writing the same value: remove it first.
		if ( self::AVAILABLE !== self::status() ) {
			delete_option( self::TOKEN_OPTION );
		}

		update_option( self::TOKEN_OPTION, $token, false );

		if ( ProtectedOptions::last_write_failed( self::TOKEN_OPTION ) ) {
			return new WP_Error(
				'instagram_token_not_stored',
				__( 'The Instagram access token could not be stored encrypted, so the previous token was kept. Try again.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		update_option( self::USER_ID_OPTION, $user_id );
		update_option( self::USERNAME_OPTION, $username );
		update_option( self::EXPIRES_OPTION, null === $expires_in ? 0 : time() + (int) $expires_in );
		update_option( self::CONNECTED_OPTION, true );

		return true;
	}

	/**
	 * Set the Instagram user ID by hand.
	 *
	 * @param string $user_id Numeric Instagram user ID, or '' to clear it.
	 * @return void
	 */
	public static function set_user_id( $user_id ) {
		update_option( self::USER_ID_OPTION, $user_id );
	}

	/**
	 * Remove the token and the connection details. Published posts and post
	 * records stay.
	 *
	 * @return void
	 */
	public static function disconnect() {
		delete_option( self::TOKEN_OPTION );
		update_option( self::USER_ID_OPTION, '' );
		update_option( self::USERNAME_OPTION, '' );
		update_option( self::EXPIRES_OPTION, 0 );
		update_option( self::CONNECTED_OPTION, false );
	}

	/**
	 * Check the token with Instagram and store the account it belongs to.
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

		$token = self::access_token();
		if ( '' === $token ) {
			return new WP_Error(
				'instagram_not_connected',
				__( 'No Instagram access token is configured. Connect with Instagram or enter an access token first.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}

		$response = wp_remote_get(
			self::GRAPH_URL . '/me?' . http_build_query(
				array(
					'fields'       => 'user_id,username',
					'access_token' => $token,
				)
			),
			array( 'timeout' => 30 )
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
			return new WP_Error(
				'instagram_token_invalid',
				__( 'Instagram refused the access token: it is invalid or expired. Connect with Instagram again or enter a new access token.', 'fair-events-experimental' ),
				array(
					'status'  => 401,
					'details' => $detail,
				)
			);
		}

		$user_id  = isset( $data['user_id'] ) ? (string) $data['user_id'] : ( isset( $data['id'] ) ? (string) $data['id'] : '' );
		$username = isset( $data['username'] ) ? sanitize_text_field( (string) $data['username'] ) : '';

		if ( '' !== $user_id && preg_match( '/^\d+$/', $user_id ) ) {
			update_option( self::USER_ID_OPTION, $user_id );
		}
		if ( '' !== $username ) {
			update_option( self::USERNAME_OPTION, $username );
		}

		return array(
			'success' => true,
			'message' => '' !== $username
				? sprintf(
					/* translators: %s: Instagram username */
					__( 'The connection works: Instagram confirmed the account @%s.', 'fair-events-experimental' ),
					$username
				)
				: __( 'The connection works.', 'fair-events-experimental' ),
		) + self::details();
	}

	/**
	 * Daily cron: refresh a token that expires within REFRESH_WINDOW through
	 * the OAuth proxy. Runs only while this plugin refreshes the token.
	 *
	 * @return void
	 */
	public static function refresh() {
		if ( ! Ownership::refreshes() ) {
			return;
		}

		// An unreadable stored token stays in place; the Instagram page
		// explains how to recover it.
		if ( self::AVAILABLE !== self::status() ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- operators need to see why the token is not refreshed.
			error_log( 'Fair Events Experimental: Instagram token refresh skipped: the stored access token cannot be read.' );
			return;
		}

		$token   = self::access_token();
		$expires = (int) get_option( self::EXPIRES_OPTION, 0 );

		if ( '' === $token || ! self::needs_refresh( $expires, time() ) ) {
			return;
		}

		$response = wp_remote_post(
			self::REFRESH_URL,
			array(
				'timeout' => 30,
				'body'    => array( 'access_token' => $token ),
			)
		);

		if ( is_wp_error( $response ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'Fair Events Experimental: Instagram token refresh failed: the OAuth proxy could not be reached.' );
			return;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $code || empty( $body['success'] ) || empty( $body['data']['access_token'] ) || ! is_string( $body['data']['access_token'] ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( sprintf( 'Fair Events Experimental: Instagram token refresh failed with status %d.', $code ) );
			return;
		}

		update_option( self::TOKEN_OPTION, $body['data']['access_token'], false );

		// The previous token was kept: leave its expiry, so the refresh is
		// tried again.
		if ( ProtectedOptions::last_write_failed( self::TOKEN_OPTION ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'Fair Events Experimental: Instagram token refresh could not store the new token encrypted; the previous token was kept.' );
			return;
		}

		$expires_in = isset( $body['data']['expires_in'] ) ? (int) $body['data']['expires_in'] : self::DEFAULT_LIFETIME;
		update_option( self::EXPIRES_OPTION, time() + ( $expires_in > 0 ? $expires_in : self::DEFAULT_LIFETIME ) );
	}

	/**
	 * Whether a token with this expiry should be refreshed now. A token of
	 * unknown expiry (0) is refreshed, which also learns its expiry.
	 *
	 * @param int $expires Unix expiry, 0 when unknown.
	 * @param int $now     Current Unix time.
	 * @return bool
	 */
	public static function needs_refresh( $expires, $now ) {
		return $expires <= 0 || ( $expires - $now ) <= self::REFRESH_WINDOW;
	}

	/**
	 * Remove the token from a message received from Instagram.
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
