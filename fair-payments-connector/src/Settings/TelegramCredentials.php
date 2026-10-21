<?php
/**
 * Encryption at rest and availability of the stored Telegram bot token
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Settings;

use FairEventsShared\Security\ProtectedOptions;
use FairEventsShared\Security\SecretReadResult;

defined( 'WPINC' ) || die;

/**
 * The Telegram bot token is stored encrypted through the shared
 * ProtectedOptions mechanism. This class registers that protection, converts
 * a token stored before it existed, and reports whether the stored token can
 * be used. The notification settings screen still reads the token back
 * through /wp/v2/settings, decrypted, for administrators.
 *
 * A stored token that cannot be decrypted is never cleared: the value stays
 * in storage, reads as empty, and Telegram deliveries fail until encryption
 * support returns, or until the admin enters the token again when the value
 * is unrecoverable.
 */
class TelegramCredentials {

	/**
	 * Protected option name.
	 */
	const OPTION = NotificationSettings::BOT_TOKEN_OPTION;

	/**
	 * Set once the stored token is encrypted (or there was none to convert).
	 */
	const CONVERSION_OPTION = 'fair_payment_telegram_credentials_converted';

	/**
	 * No token is stored.
	 */
	const MISSING = 'missing';

	/**
	 * The token can be used, encrypted or plaintext.
	 */
	const AVAILABLE = 'available';

	/**
	 * The token is encrypted, but encryption support is unavailable.
	 */
	const ENCRYPTION_UNAVAILABLE = 'encryption_unavailable';

	/**
	 * The token is encrypted and cannot be recovered; entering it again replaces it.
	 */
	const UNRECOVERABLE = 'unrecoverable';

	/**
	 * Protect the token option and guard its settings writes. Runs on every
	 * request, whichever plugin currently owns notifications, and whether or
	 * not any Telegram route is enabled.
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
		add_filter( 'rest_post_dispatch', array( self::class, 'report_failed_write' ), 10, 3 );
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
	 * Whether a token is stored and can be used.
	 *
	 * @return string One of MISSING, AVAILABLE, ENCRYPTION_UNAVAILABLE, UNRECOVERABLE.
	 */
	public static function status() {
		if ( class_exists( ProtectedOptions::class ) ) {
			$read = ProtectedOptions::read( self::OPTION )->status();

			if ( SecretReadResult::UNRECOVERABLE === $read ) {
				return self::UNRECOVERABLE;
			}
			if ( SecretReadResult::UNSUPPORTED === $read ) {
				return self::ENCRYPTION_UNAVAILABLE;
			}
		}

		return '' === self::token() ? self::MISSING : self::AVAILABLE;
	}

	/**
	 * The usable token.
	 *
	 * @return string Empty when no token is stored, or it cannot be read.
	 */
	public static function token() {
		return trim( (string) get_option( self::OPTION, '' ) );
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
	 * Administrator-facing explanation of a status.
	 *
	 * @param string $status Status from status().
	 * @return string Empty for AVAILABLE.
	 */
	public static function admin_message( $status ) {
		if ( self::MISSING === $status ) {
			return __( 'Telegram bot token is not configured.', 'fair-payments-connector' );
		}

		if ( self::ENCRYPTION_UNAVAILABLE === $status ) {
			return __( 'Telegram notifications are paused: the bot token is stored encrypted, but this server no longer provides the Sodium encryption support needed to read it. Ask your host to restore PHP Sodium support; notifications then resume without entering the token again.', 'fair-payments-connector' );
		}

		if ( self::UNRECOVERABLE === $status ) {
			return __( 'Telegram notifications are paused: the stored bot token can no longer be read. This happens when the site’s security keys change or the database is moved to another site. Enter the bot token again and save the settings.', 'fair-payments-connector' );
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
			'fair_payment_telegram_token_not_stored',
			self::admin_message( self::ENCRYPTION_UNAVAILABLE ),
			array( 'status' => 409 )
		);
	}

	/**
	 * `rest_post_dispatch` callback: report a settings write whose token was
	 * not stored, instead of a success.
	 *
	 * @param \WP_REST_Response $response Response.
	 * @param \WP_REST_Server   $server   Server instance.
	 * @param \WP_REST_Request  $request  Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function report_failed_write( $response, $server, $request ) {
		if ( ! self::is_settings_write( $request ) || ! self::last_write_failed() ) {
			return $response;
		}

		return new \WP_Error(
			'fair_payment_telegram_token_not_stored',
			__( 'The Telegram bot token could not be stored encrypted, so the previous token was kept. Try again.', 'fair-payments-connector' ),
			array( 'status' => 500 )
		);
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
