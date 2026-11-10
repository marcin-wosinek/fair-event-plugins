<?php
/**
 * Transparent encryption at rest for named WordPress options.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Security;

defined( 'WPINC' ) || die;

/**
 * Opt-in encryption of string secrets stored as WordPress options.
 *
 * After protect( 'my_option' ), every add_option()/update_option() of a
 * non-empty string stores an encrypted envelope, and get_option() returns the
 * plaintext. Callers keep using the ordinary option API. Register protection
 * on every request, before the option is read or written, including outside
 * the admin: a background or visitor request may rewrite the secret.
 *
 * The key is derived from the WordPress `secure_auth` salt and the option
 * name; nothing new is stored. Changing the site's security keys, or moving
 * the database to a site with other keys, makes stored values unrecoverable.
 * When WordPress keeps its keys in the database (they are not defined in
 * wp-config.php), a full database dump includes the key material, so this
 * protects against partial leaks only.
 *
 * Without encryption support (see is_supported()):
 *  - plaintext values stay readable, and new values are stored as plaintext
 *    unless the option already holds an envelope;
 *  - an existing envelope is never replaced by plaintext and reads as an
 *    empty string; read() reports it as temporarily unavailable.
 *
 * An envelope that cannot be decrypted is left in storage unchanged, reads
 * as an empty string, and read() reports it as unrecoverable.
 */
final class ProtectedOptions {

	/**
	 * Fixed application context mixed into every option key.
	 */
	const KEY_CONTEXT = 'fair-events-shared/protected-option/v1';

	/**
	 * Filter that can switch encryption support off (or on).
	 */
	const SUPPORT_FILTER = 'fair_events_shared_encryption_supported';

	/**
	 * Conversion outcomes.
	 */
	const CONVERTED   = 'converted';
	const ENCRYPTED   = 'encrypted';
	const EMPTY_VALUE = 'empty';
	const UNSUPPORTED = 'unsupported';
	const FAILED      = 'failed';
	const CHANGED     = 'changed';

	/**
	 * Protected option names, as keys.
	 *
	 * @var array<string, true>
	 */
	private static $options = array();

	/**
	 * Depth of raw (undecrypted) reads in progress.
	 *
	 * @var int
	 */
	private static $raw_reads = 0;

	/**
	 * Options whose last write kept the previous value instead of the new one.
	 *
	 * @var array<string, true>
	 */
	private static $failed_writes = array();

	/**
	 * Last decryption per option: array( stored envelope, key, result ).
	 *
	 * @var array<string, array{0: string, 1: string|null, 2: SecretReadResult}>
	 */
	private static $decrypted = array();

	/**
	 * Protect an option. Safe to call more than once.
	 *
	 * @param string $option Option name.
	 * @return void
	 */
	public static function protect( $option ) {
		if ( isset( self::$options[ $option ] ) ) {
			return;
		}
		self::$options[ $option ] = true;

		// sanitize_option() runs for both add_option() and update_option().
		// Run last, after any register_setting() sanitize callback.
		add_filter( "sanitize_option_{$option}", array( __CLASS__, 'filter_write' ), PHP_INT_MAX, 2 );
		// Run first, so other option filters see the plaintext.
		add_filter( "option_{$option}", array( __CLASS__, 'filter_read' ), -PHP_INT_MAX, 2 );
	}

	/**
	 * Whether an option is protected in this request.
	 *
	 * @param string $option Option name.
	 * @return bool
	 */
	public static function is_protected( $option ) {
		return isset( self::$options[ $option ] );
	}

	/**
	 * Whether this request can encrypt and decrypt.
	 *
	 * @return bool
	 */
	public static function is_supported() {
		/**
		 * Filters whether protected options can be encrypted and decrypted.
		 *
		 * @param bool $supported Whether the Sodium primitives are available.
		 */
		return (bool) apply_filters( self::SUPPORT_FILTER, SecretBox::is_supported() );
	}

	/**
	 * Read an option and report whether its value is usable.
	 *
	 * @param string $option Option name.
	 * @return SecretReadResult
	 */
	public static function read( $option ) {
		return self::inspect( $option, self::raw( $option ) );
	}

	/**
	 * Whether a new value written now would be stored. False only while
	 * encryption support is unavailable and the option holds an envelope,
	 * which is never replaced by plaintext.
	 *
	 * @param string $option Option name.
	 * @return bool
	 */
	public static function can_store( $option ) {
		return self::is_supported() || ! SecretBox::is_envelope( self::raw( $option ) );
	}

	/**
	 * Whether the last write of a plaintext value in this request was not
	 * stored, because encryption failed or because encryption support is
	 * unavailable and the option holds an envelope. The previous value was
	 * kept in both cases.
	 *
	 * @param string $option Option name.
	 * @return bool
	 */
	public static function last_write_failed( $option ) {
		return isset( self::$failed_writes[ $option ] );
	}

	/**
	 * The stored value of an option, without decryption.
	 *
	 * @param string $option Option name.
	 * @return mixed Stored value, or false when the option does not exist.
	 */
	public static function raw( $option ) {
		++self::$raw_reads;
		try {
			return get_option( $option, false );
		} finally {
			--self::$raw_reads;
		}
	}

	/**
	 * Encrypt a stored plaintext value in place.
	 *
	 * Idempotent: an empty, missing or already encrypted value is left as it
	 * is. The write only applies while the option still holds the plaintext
	 * that was read, so a concurrent change is never overwritten.
	 *
	 * @param string $option Option name.
	 * @return string One of the conversion outcome constants. UNSUPPORTED and
	 *                FAILED leave the plaintext in place, to retry later.
	 */
	public static function convert( $option ) {
		global $wpdb;

		$raw = self::raw( $option );

		if ( ! is_string( $raw ) || '' === $raw ) {
			return self::EMPTY_VALUE;
		}

		if ( SecretBox::is_envelope( $raw ) ) {
			return self::ENCRYPTED;
		}

		if ( ! self::is_supported() ) {
			return self::UNSUPPORTED;
		}

		$envelope = SecretBox::encrypt( $raw, self::key( $option ) );
		if ( null === $envelope ) {
			return self::FAILED;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- compare-and-swap on the stored value; the option caches are cleared below.
		$updated = $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET option_value = %s WHERE option_name = %s AND option_value = %s',
				$wpdb->options,
				$envelope,
				$option,
				$raw
			)
		);

		wp_cache_delete( $option, 'options' );
		wp_cache_delete( 'alloptions', 'options' );

		if ( false === $updated ) {
			return self::FAILED;
		}

		return 1 === (int) $updated ? self::CONVERTED : self::CHANGED;
	}

	/**
	 * `sanitize_option_{$option}` callback: encrypt the value being stored.
	 *
	 * @param mixed  $value  Value being stored.
	 * @param string $option Option name.
	 * @return mixed Value to store.
	 */
	public static function filter_write( $value, $option ) {
		if ( ! is_string( $value ) || '' === $value || SecretBox::is_envelope( $value ) ) {
			return $value;
		}

		unset( self::$failed_writes[ $option ] );
		$previous = self::raw( $option );

		if ( ! self::is_supported() ) {
			// Plaintext fallback, but never over an existing envelope.
			if ( ! SecretBox::is_envelope( $previous ) ) {
				return $value;
			}
			self::$failed_writes[ $option ] = true;
			return $previous;
		}

		$envelope = SecretBox::encrypt( $value, self::key( $option ) );
		if ( null !== $envelope ) {
			return $envelope;
		}

		// Encryption failed: keep what was stored rather than plaintext.
		self::$failed_writes[ $option ] = true;
		return false === $previous ? '' : $previous;
	}

	/**
	 * `option_{$option}` callback: decrypt the stored value.
	 *
	 * @param mixed  $value  Stored value.
	 * @param string $option Option name.
	 * @return mixed Plaintext, or an empty string when it cannot be read.
	 */
	public static function filter_read( $value, $option ) {
		if ( self::$raw_reads > 0 ) {
			return $value;
		}

		$result = self::inspect( $option, $value );

		return $result->is_readable() ? $result->value() : '';
	}

	/**
	 * Classify a stored value of an option.
	 *
	 * @param string $option Option name.
	 * @param mixed  $value  Stored value.
	 * @return SecretReadResult
	 */
	private static function inspect( $option, $value ) {
		if ( ! SecretBox::is_envelope( $value ) ) {
			return SecretReadResult::readable( $value, false );
		}

		if ( ! self::is_supported() ) {
			return SecretBox::decrypt( $value, null );
		}

		$key = self::key( $option );

		if ( isset( self::$decrypted[ $option ] ) && self::$decrypted[ $option ][0] === $value && self::$decrypted[ $option ][1] === $key ) {
			return self::$decrypted[ $option ][2];
		}

		$result = SecretBox::decrypt( $value, $key );

		self::$decrypted[ $option ] = array( $value, $key, $result );

		return $result;
	}

	/**
	 * Key for an option, derived from the WordPress `secure_auth` salt.
	 *
	 * @param string $option Option name.
	 * @return string|null Binary key, or null when no key material is available yet.
	 */
	private static function key( $option ) {
		if ( ! function_exists( 'wp_salt' ) ) {
			return null;
		}

		return SecretBox::derive_key( wp_salt( 'secure_auth' ), self::KEY_CONTEXT . '|' . $option );
	}
}
