<?php
/**
 * Authenticated encryption of stored secrets.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Security;

defined( 'WPINC' ) || die;

/**
 * Encrypts and decrypts string secrets with Sodium's secretbox
 * (XSalsa20-Poly1305), into a versioned text envelope.
 *
 * An envelope is `fes-enc:v1:` followed by base64 of a fresh random nonce and
 * the ciphertext. Anything starting with `fes-enc:` is treated as an
 * envelope, so an unknown version or a damaged value is rejected rather than
 * mistaken for a plaintext secret.
 *
 * This class has no WordPress dependency and no key storage of its own: the
 * caller supplies key material it already has and a context naming what the
 * key protects. See ProtectedOptions for the WordPress option integration.
 */
final class SecretBox {

	/**
	 * Prefix shared by every envelope version.
	 */
	const FAMILY_PREFIX = 'fes-enc:';

	/**
	 * Prefix of the envelope version this class writes.
	 */
	const PREFIX = 'fes-enc:v1:';

	/**
	 * Secretbox nonce length in bytes.
	 */
	const NONCE_BYTES = 24;

	/**
	 * Secretbox authentication tag length in bytes.
	 */
	const MAC_BYTES = 16;

	/**
	 * Whether the Sodium secretbox primitives are available.
	 *
	 * @return bool
	 */
	public static function is_supported() {
		return function_exists( 'sodium_crypto_secretbox' )
			&& function_exists( 'sodium_crypto_secretbox_open' )
			&& function_exists( 'random_bytes' );
	}

	/**
	 * Whether a stored value is an envelope (of any version), as opposed to a
	 * plaintext secret.
	 *
	 * @param mixed $value Stored value.
	 * @return bool
	 */
	public static function is_envelope( $value ) {
		return is_string( $value ) && 0 === strpos( $value, self::FAMILY_PREFIX );
	}

	/**
	 * Derive a 32-byte key from existing key material and a context.
	 *
	 * Different contexts give unrelated keys, so a value encrypted for one
	 * purpose cannot be decrypted as another.
	 *
	 * @param string $material Secret key material (e.g. WordPress salts).
	 * @param string $context  What the key protects.
	 * @return string|null Binary key, or null when there is no key material.
	 */
	public static function derive_key( $material, $context ) {
		if ( ! is_string( $material ) || '' === $material ) {
			return null;
		}

		return hash_hmac( 'sha256', (string) $context, $material, true );
	}

	/**
	 * Encrypt a plaintext into a new envelope. Each call uses a fresh nonce,
	 * so encrypting the same plaintext twice gives different envelopes.
	 *
	 * @param string $plaintext Secret to encrypt.
	 * @param string $key       Key from derive_key().
	 * @return string|null Envelope, or null when encryption is unavailable or failed.
	 */
	public static function encrypt( $plaintext, $key ) {
		if ( ! self::is_supported() || ! is_string( $plaintext ) || ! is_string( $key ) || 32 !== strlen( $key ) ) {
			return null;
		}

		try {
			$nonce      = random_bytes( self::NONCE_BYTES );
			$ciphertext = sodium_crypto_secretbox( $plaintext, $nonce, $key );
		} catch ( \Throwable $e ) {
			return null;
		}

		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- binary-safe text encoding of ciphertext, not obfuscation.
		return self::PREFIX . base64_encode( $nonce . $ciphertext );
	}

	/**
	 * Read a stored value: plaintext and empty values pass through unchanged,
	 * envelopes are decrypted.
	 *
	 * @param mixed       $value Stored value.
	 * @param string|null $key   Key from derive_key(), or null when unavailable.
	 * @return SecretReadResult
	 */
	public static function decrypt( $value, $key ) {
		if ( ! self::is_envelope( $value ) ) {
			return SecretReadResult::readable( $value, false );
		}

		$payload = self::payload( $value );
		if ( null === $payload ) {
			return SecretReadResult::unrecoverable();
		}

		if ( ! self::is_supported() || ! is_string( $key ) ) {
			return SecretReadResult::unsupported();
		}

		if ( 32 !== strlen( $key ) ) {
			return SecretReadResult::unrecoverable();
		}

		try {
			$plaintext = sodium_crypto_secretbox_open(
				substr( $payload, self::NONCE_BYTES ),
				substr( $payload, 0, self::NONCE_BYTES ),
				$key
			);
		} catch ( \Throwable $e ) {
			return SecretReadResult::unrecoverable();
		}

		if ( ! is_string( $plaintext ) ) {
			return SecretReadResult::unrecoverable();
		}

		return SecretReadResult::readable( $plaintext, true );
	}

	/**
	 * Nonce and ciphertext of a well-formed current-version envelope.
	 *
	 * @param string $envelope Envelope.
	 * @return string|null Binary payload, or null when malformed or of an unknown version.
	 */
	private static function payload( $envelope ) {
		if ( 0 !== strpos( $envelope, self::PREFIX ) ) {
			return null;
		}

		$encoded = substr( $envelope, strlen( self::PREFIX ) );
		if ( '' === $encoded || ! preg_match( '/^[A-Za-z0-9+\/]+={0,2}$/', $encoded ) ) {
			return null;
		}

		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- decoding our own ciphertext envelope.
		$payload = base64_decode( $encoded, true );
		if ( false === $payload || strlen( $payload ) < self::NONCE_BYTES + self::MAC_BYTES ) {
			return null;
		}

		return $payload;
	}
}
