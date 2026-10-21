<?php
/**
 * Encryption at rest and availability of the stored Instagram access token
 *
 * @package FairAudience
 */

namespace FairAudience\Settings;

use FairEventsShared\Security\ProtectedOptions;
use FairEventsShared\Security\SecretReadResult;

defined( 'WPINC' ) || die;

/**
 * The Instagram access token is stored encrypted through the shared
 * ProtectedOptions mechanism. This class registers that protection, converts
 * a token stored before it existed, reports whether the stored token can be
 * used, and keeps the token out of /wp/v2/settings responses: the settings
 * screen writes it there but never reads it back.
 *
 * A stored token that cannot be decrypted never clears the connection: the
 * value stays in storage, and Instagram is reported unavailable until
 * encryption support returns, or until the admin reconnects when the value
 * is unrecoverable. Disconnecting (saving an empty token) removes it.
 */
class InstagramCredentials {

	/**
	 * Protected option name.
	 */
	const OPTION = 'fair_audience_instagram_access_token';

	/**
	 * Stored connection flag, kept while the token is unreadable.
	 */
	const CONNECTED_OPTION = 'fair_audience_instagram_connected';

	/**
	 * Set once the stored token is encrypted (or there was none to convert).
	 */
	const CONVERSION_OPTION = 'fair_audience_instagram_credentials_converted';

	/**
	 * The token can be used: encrypted, plaintext, or not stored at all.
	 */
	const AVAILABLE = 'available';

	/**
	 * The token is encrypted, but encryption support is unavailable.
	 */
	const ENCRYPTION_UNAVAILABLE = 'encryption_unavailable';

	/**
	 * The token is encrypted and cannot be recovered; reconnecting replaces it.
	 */
	const UNRECOVERABLE = 'unrecoverable';

	/**
	 * Protect the token option and guard its settings REST surface. Runs on
	 * every request, before the token is read or written — the daily token
	 * refresh rewrites it outside the admin.
	 *
	 * @return void
	 */
	public static function init() {
		if ( ! class_exists( ProtectedOptions::class ) ) {
			return;
		}

		ProtectedOptions::protect( self::OPTION );
		add_action( 'init', array( self::class, 'maybe_convert' ) );
		add_filter( 'rest_pre_dispatch', array( self::class, 'refuse_unstorable_write' ), 10, 3 );
		add_filter( 'rest_pre_update_setting', array( self::class, 'clear_unreadable_token' ), 10, 3 );
		add_filter( 'rest_post_dispatch', array( self::class, 'filter_settings_response' ), 10, 3 );
	}

	/**
	 * Encrypt a token stored as plaintext, once. While encryption support is
	 * unavailable, or the conversion fails, the plaintext stays usable and
	 * the conversion is tried again on a later request.
	 *
	 * @return void
	 */
	public static function maybe_convert() {
		if ( get_option( self::CONVERSION_OPTION ) ) {
			return;
		}

		$done = array( ProtectedOptions::CONVERTED, ProtectedOptions::ENCRYPTED, ProtectedOptions::EMPTY_VALUE, ProtectedOptions::CHANGED );

		if ( in_array( ProtectedOptions::convert( self::OPTION ), $done, true ) ) {
			update_option( self::CONVERSION_OPTION, 1 );
		}
	}

	/**
	 * Whether the stored token can be used.
	 *
	 * @return string One of AVAILABLE, ENCRYPTION_UNAVAILABLE, UNRECOVERABLE.
	 */
	public static function status() {
		if ( ! class_exists( ProtectedOptions::class ) ) {
			return self::AVAILABLE;
		}

		switch ( ProtectedOptions::read( self::OPTION )->status() ) {
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
	 * @return bool
	 */
	public static function is_available() {
		return self::AVAILABLE === self::status();
	}

	/**
	 * Whether Instagram is connected and its token can be used. The stored
	 * connection flag stays set while the token is unreadable.
	 *
	 * @return bool
	 */
	public static function is_connected() {
		return (bool) get_option( self::CONNECTED_OPTION, false ) && self::is_available();
	}

	/**
	 * Whether the stored token is encrypted.
	 *
	 * @return bool False when the token is stored as plaintext, or not stored.
	 */
	public static function is_encrypted() {
		if ( ! class_exists( ProtectedOptions::class ) ) {
			return false;
		}

		$raw = ProtectedOptions::raw( self::OPTION );

		return is_string( $raw ) && '' !== $raw && ProtectedOptions::read( self::OPTION )->is_encrypted();
	}

	/**
	 * Whether a new token written now would be stored. False while encryption
	 * support is unavailable and the stored token is encrypted: it is never
	 * replaced by plaintext.
	 *
	 * @return bool
	 */
	public static function can_store() {
		return ! class_exists( ProtectedOptions::class ) || ProtectedOptions::can_store( self::OPTION );
	}

	/**
	 * Whether the last token write in this request kept the previous value
	 * instead of storing the new one.
	 *
	 * @return bool
	 */
	public static function last_write_failed() {
		return class_exists( ProtectedOptions::class ) && ProtectedOptions::last_write_failed( self::OPTION );
	}

	/**
	 * Administrator-facing explanation of an unavailable status.
	 *
	 * @param string $status Status from status().
	 * @return string Empty for AVAILABLE.
	 */
	public static function admin_message( $status ) {
		if ( self::ENCRYPTION_UNAVAILABLE === $status ) {
			return __( 'Instagram is paused: the access token is stored encrypted, but this server no longer provides the Sodium encryption support needed to read it. Ask your host to restore PHP Sodium support; Instagram then resumes without reconnecting.', 'fair-audience' );
		}

		if ( self::UNRECOVERABLE === $status ) {
			return __( 'Instagram needs to be reconnected: the stored access token can no longer be read. This happens when the site’s security keys change or the database is moved to another site. Connect with Instagram or enter a new access token.', 'fair-audience' );
		}

		return '';
	}

	/**
	 * `rest_pre_dispatch` callback: refuse a settings write that would replace
	 * the token while it cannot be stored, before any setting is written.
	 *
	 * @param mixed            $result  Response to replace the requested one with.
	 * @param \WP_REST_Server  $server  Server instance.
	 * @param \WP_REST_Request $request Request.
	 * @return mixed
	 */
	public static function refuse_unstorable_write( $result, $server, $request ) {
		if ( null !== $result || ! self::is_settings_write( $request ) ) {
			return $result;
		}

		$token = $request->get_param( self::OPTION );
		if ( ! is_string( $token ) || '' === $token || self::can_store() ) {
			return $result;
		}

		return new \WP_Error(
			'fair_audience_instagram_token_not_stored',
			self::admin_message( self::ENCRYPTION_UNAVAILABLE ),
			array( 'status' => 409 )
		);
	}

	/**
	 * `rest_pre_update_setting` callback: an empty token disconnects, and must
	 * remove an unreadable stored token too. update_option() would skip that
	 * write, since the unreadable value already reads as empty.
	 *
	 * @param bool   $handled Whether the setting was already updated.
	 * @param string $name    Setting name in the REST API.
	 * @param mixed  $value   New value.
	 * @return bool
	 */
	public static function clear_unreadable_token( $handled, $name, $value ) {
		if ( $handled || self::OPTION !== $name || '' !== $value || self::is_available() ) {
			return $handled;
		}

		delete_option( self::OPTION );

		return true;
	}

	/**
	 * `rest_post_dispatch` callback for /wp/v2/settings: report a token that
	 * was not stored, and drop the token from the response.
	 *
	 * @param \WP_REST_Response $response Response.
	 * @param \WP_REST_Server   $server   Server instance.
	 * @param \WP_REST_Request  $request  Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function filter_settings_response( $response, $server, $request ) {
		if ( '/wp/v2/settings' !== $request->get_route() || ! $response instanceof \WP_REST_Response ) {
			return $response;
		}

		if ( self::is_settings_write( $request ) && self::last_write_failed() ) {
			return new \WP_Error(
				'fair_audience_instagram_token_not_stored',
				__( 'The Instagram access token could not be stored encrypted, so the previous token was kept. Try again.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		$data = $response->get_data();
		if ( is_array( $data ) && array_key_exists( self::OPTION, $data ) ) {
			unset( $data[ self::OPTION ] );
			$response->set_data( $data );
		}

		return $response;
	}

	/**
	 * Whether a request writes settings through /wp/v2/settings.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return bool
	 */
	private static function is_settings_write( $request ) {
		return '/wp/v2/settings' === $request->get_route() && 'GET' !== $request->get_method();
	}
}
