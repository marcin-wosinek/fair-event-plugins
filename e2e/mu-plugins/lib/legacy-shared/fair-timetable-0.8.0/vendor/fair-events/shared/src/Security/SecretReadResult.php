<?php
/**
 * Outcome of reading a possibly encrypted stored secret.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Security;

defined( 'WPINC' ) || die;

/**
 * Immutable result of SecretBox::decrypt() and ProtectedOptions::read().
 *
 * A secret is either readable (plaintext, empty, or successfully decrypted),
 * temporarily unavailable because encryption support is missing, or
 * unrecoverable (wrong key, tampered, or malformed). Only a readable result
 * carries a value: an unreadable one never exposes the stored ciphertext.
 */
final class SecretReadResult {

	/**
	 * The value can be used.
	 */
	const READABLE = 'readable';

	/**
	 * The value is encrypted, but this request cannot decrypt it because
	 * encryption support is unavailable. Restoring support recovers it.
	 */
	const UNSUPPORTED = 'unsupported';

	/**
	 * The value is encrypted and cannot be decrypted with the current key
	 * material, or it is not a valid envelope.
	 */
	const UNRECOVERABLE = 'unrecoverable';

	/**
	 * One of the status constants.
	 *
	 * @var string
	 */
	private $status;

	/**
	 * The usable value, or null when not readable.
	 *
	 * @var mixed
	 */
	private $value;

	/**
	 * Whether the stored form was an encrypted envelope.
	 *
	 * @var bool
	 */
	private $encrypted;

	/**
	 * Constructor.
	 *
	 * @param string $status    One of the status constants.
	 * @param mixed  $value     Usable value (readable results only).
	 * @param bool   $encrypted Whether the stored form was encrypted.
	 */
	private function __construct( $status, $value, $encrypted ) {
		$this->status    = $status;
		$this->value     = $value;
		$this->encrypted = $encrypted;
	}

	/**
	 * A usable value.
	 *
	 * @param mixed $value     The value.
	 * @param bool  $encrypted Whether it was stored encrypted.
	 * @return self
	 */
	public static function readable( $value, $encrypted ) {
		return new self( self::READABLE, $value, (bool) $encrypted );
	}

	/**
	 * An encrypted value that cannot be read without encryption support.
	 *
	 * @return self
	 */
	public static function unsupported() {
		return new self( self::UNSUPPORTED, null, true );
	}

	/**
	 * An encrypted value that cannot be recovered.
	 *
	 * @return self
	 */
	public static function unrecoverable() {
		return new self( self::UNRECOVERABLE, null, true );
	}

	/**
	 * Status constant.
	 *
	 * @return string
	 */
	public function status() {
		return $this->status;
	}

	/**
	 * Whether the value can be used.
	 *
	 * @return bool
	 */
	public function is_readable() {
		return self::READABLE === $this->status;
	}

	/**
	 * The usable value, or null when not readable.
	 *
	 * @return mixed
	 */
	public function value() {
		return $this->value;
	}

	/**
	 * Whether the stored form was an encrypted envelope.
	 *
	 * @return bool
	 */
	public function is_encrypted() {
		return $this->encrypted;
	}
}
