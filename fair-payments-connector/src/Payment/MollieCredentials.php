<?php
/**
 * Encryption at rest and availability of the stored Mollie credentials
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Payment;

use FairEventsShared\Security\ProtectedOptions;
use FairEventsShared\Security\SecretReadResult;

defined( 'WPINC' ) || die;

/**
 * The Mollie OAuth access and refresh tokens are stored encrypted through
 * the shared ProtectedOptions mechanism. This class registers that
 * protection, converts tokens stored before it existed, and reports whether
 * the stored tokens can be used.
 *
 * A stored token that cannot be decrypted never clears the connection: the
 * value stays in storage, and the connection is reported unavailable until
 * encryption support returns, or until the admin reconnects when the value
 * is unrecoverable.
 */
class MollieCredentials {

	/**
	 * Protected option names.
	 */
	const OPTIONS = array(
		'fair_payment_mollie_access_token',
		'fair_payment_mollie_refresh_token',
	);

	/**
	 * Set once every stored token is encrypted (or there was none to convert).
	 */
	const CONVERSION_OPTION = 'fair_payment_mollie_credentials_converted';

	/**
	 * The tokens can be used: encrypted, plaintext, or not stored at all.
	 */
	const AVAILABLE = 'available';

	/**
	 * The tokens are encrypted, but encryption support is unavailable.
	 */
	const ENCRYPTION_UNAVAILABLE = 'encryption_unavailable';

	/**
	 * A token is encrypted and cannot be recovered; reconnecting replaces it.
	 */
	const UNRECOVERABLE = 'unrecoverable';

	/**
	 * Protect the token options. Runs on every request, before any token is
	 * read or written — a visitor's checkout can refresh and rewrite them.
	 *
	 * @return void
	 */
	public static function protect() {
		if ( ! class_exists( ProtectedOptions::class ) ) {
			return;
		}

		foreach ( self::OPTIONS as $option ) {
			ProtectedOptions::protect( $option );
		}
	}

	/**
	 * Encrypt tokens stored as plaintext, once. While encryption support is
	 * unavailable, or a conversion fails, the plaintext stays usable and the
	 * conversion is tried again on a later request.
	 *
	 * @return void
	 */
	public static function maybe_convert() {
		if ( ! class_exists( ProtectedOptions::class ) || get_option( self::CONVERSION_OPTION ) ) {
			return;
		}

		$done = array( ProtectedOptions::CONVERTED, ProtectedOptions::ENCRYPTED, ProtectedOptions::EMPTY_VALUE, ProtectedOptions::CHANGED );

		$complete = true;
		foreach ( self::OPTIONS as $option ) {
			if ( ! in_array( ProtectedOptions::convert( $option ), $done, true ) ) {
				$complete = false;
			}
		}

		if ( $complete ) {
			update_option( self::CONVERSION_OPTION, 1 );
		}
	}

	/**
	 * Whether the stored tokens can be used.
	 *
	 * @return string One of AVAILABLE, ENCRYPTION_UNAVAILABLE, UNRECOVERABLE.
	 */
	public static function status() {
		if ( ! class_exists( ProtectedOptions::class ) ) {
			return self::AVAILABLE;
		}

		$status = self::AVAILABLE;
		foreach ( self::OPTIONS as $option ) {
			$read = ProtectedOptions::read( $option )->status();

			// Unrecoverable needs a reconnect whatever the other token says.
			if ( SecretReadResult::UNRECOVERABLE === $read ) {
				return self::UNRECOVERABLE;
			}
			if ( SecretReadResult::UNSUPPORTED === $read ) {
				$status = self::ENCRYPTION_UNAVAILABLE;
			}
		}

		return $status;
	}

	/**
	 * Whether the stored tokens can be used.
	 *
	 * @return bool
	 */
	public static function is_available() {
		return self::AVAILABLE === self::status();
	}

	/**
	 * Whether every stored token is encrypted.
	 *
	 * @return bool False when a token is stored as plaintext, or none is stored.
	 */
	public static function is_encrypted() {
		if ( ! class_exists( ProtectedOptions::class ) ) {
			return false;
		}

		$any = false;
		foreach ( self::OPTIONS as $option ) {
			$raw = ProtectedOptions::raw( $option );
			if ( ! is_string( $raw ) || '' === $raw ) {
				continue;
			}
			if ( ! ProtectedOptions::read( $option )->is_encrypted() ) {
				return false;
			}
			$any = true;
		}

		return $any;
	}

	/**
	 * Whether new tokens written now would be stored. False while encryption
	 * support is unavailable and the stored tokens are encrypted: they are
	 * never replaced by plaintext.
	 *
	 * @return bool
	 */
	public static function can_store() {
		if ( ! class_exists( ProtectedOptions::class ) ) {
			return true;
		}

		foreach ( self::OPTIONS as $option ) {
			if ( ! ProtectedOptions::can_store( $option ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Whether the last token write in this request kept the previous value
	 * instead of storing the new one.
	 *
	 * @return bool
	 */
	public static function last_write_failed() {
		if ( ! class_exists( ProtectedOptions::class ) ) {
			return false;
		}

		foreach ( self::OPTIONS as $option ) {
			if ( ProtectedOptions::last_write_failed( $option ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Administrator-facing explanation of an unavailable status.
	 *
	 * @param string $status Status from status().
	 * @return string Empty for AVAILABLE.
	 */
	public static function admin_message( $status ) {
		if ( self::ENCRYPTION_UNAVAILABLE === $status ) {
			return __( 'Payments are paused: the Mollie connection is stored encrypted, but this server no longer provides the Sodium encryption support needed to read it. Ask your host to restore PHP Sodium support; the connection then resumes without reconnecting.', 'fair-payments-connector' );
		}

		if ( self::UNRECOVERABLE === $status ) {
			return __( 'Payments are paused: the stored Mollie connection can no longer be read. This happens when the site’s security keys change or the database is moved to another site. Reconnect to Mollie to resume payments.', 'fair-payments-connector' );
		}

		return '';
	}
}
