<?php
/**
 * FairEventsShared\Security\SecretBox tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Shared;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Security\SecretBox;
use FairEventsShared\Security\SecretReadResult;

/**
 * Unit tests for the shared secret encryption, in isolation from WordPress.
 */
class SecretBoxTest extends TestCase {

	/**
	 * Key used by most tests.
	 *
	 * @var string
	 */
	private $key;

	/**
	 * Derive the shared test key.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->key = SecretBox::derive_key( 'site-security-keys', 'test-context' );
	}

	/** Sodium is available where these tests run. */
	public function test_is_supported(): void {
		$this->assertTrue( SecretBox::is_supported() );
	}

	/** An encrypted secret decrypts back to the plaintext. */
	public function test_round_trip(): void {
		$envelope = SecretBox::encrypt( 'access_live_secret', $this->key );

		$result = SecretBox::decrypt( $envelope, $this->key );

		$this->assertTrue( $result->is_readable() );
		$this->assertTrue( $result->is_encrypted() );
		$this->assertSame( 'access_live_secret', $result->value() );
	}

	/** An envelope is opaque and distinguishable from plaintext. */
	public function test_envelope_is_opaque_and_distinguishable(): void {
		$envelope = SecretBox::encrypt( 'access_live_secret', $this->key );

		$this->assertStringStartsWith( SecretBox::PREFIX, $envelope );
		$this->assertStringNotContainsString( 'access_live_secret', $envelope );
		$this->assertTrue( SecretBox::is_envelope( $envelope ) );
		$this->assertFalse( SecretBox::is_envelope( 'access_live_secret' ) );
	}

	/** A fresh nonce per call: the same plaintext never gives the same envelope. */
	public function test_repeated_encryption_differs(): void {
		$this->assertNotSame(
			SecretBox::encrypt( 'same', $this->key ),
			SecretBox::encrypt( 'same', $this->key )
		);
	}

	/** A plaintext value passes through as readable and not encrypted. */
	public function test_plaintext_passes_through(): void {
		$result = SecretBox::decrypt( 'refresh_plain_token', $this->key );

		$this->assertTrue( $result->is_readable() );
		$this->assertFalse( $result->is_encrypted() );
		$this->assertSame( 'refresh_plain_token', $result->value() );
	}

	/** Empty and missing values stay readable. */
	public function test_empty_values_are_readable(): void {
		foreach ( array( '', false, null ) as $empty ) {
			$result = SecretBox::decrypt( $empty, $this->key );
			$this->assertTrue( $result->is_readable() );
			$this->assertSame( $empty, $result->value() );
		}
	}

	/** An empty string still encrypts to an envelope that round-trips. */
	public function test_empty_string_round_trip(): void {
		$envelope = SecretBox::encrypt( '', $this->key );

		$this->assertSame( '', SecretBox::decrypt( $envelope, $this->key )->value() );
	}

	/** A tampered ciphertext fails authentication safely. */
	public function test_tampered_value_is_unrecoverable(): void {
		$envelope = SecretBox::encrypt( 'access_live_secret', $this->key );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		$payload                           = base64_decode( substr( $envelope, strlen( SecretBox::PREFIX ) ) );
		$payload[ strlen( $payload ) - 1 ] = chr( ord( $payload[ strlen( $payload ) - 1 ] ) ^ 1 );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
		$tampered = SecretBox::PREFIX . base64_encode( $payload );

		$result = SecretBox::decrypt( $tampered, $this->key );

		$this->assertSame( SecretReadResult::UNRECOVERABLE, $result->status() );
		$this->assertNull( $result->value() );
	}

	/** Malformed and unknown-version envelopes are rejected, never read as plaintext. */
	public function test_malformed_and_unknown_envelopes_are_unrecoverable(): void {
		$valid = SecretBox::encrypt( 'x', $this->key );

		$malformed = array(
			SecretBox::PREFIX,
			SecretBox::PREFIX . 'not base64!',
			// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
			SecretBox::PREFIX . base64_encode( 'too short' ),
			'fes-enc:v9:' . substr( $valid, strlen( SecretBox::PREFIX ) ),
			'fes-enc:',
		);

		foreach ( $malformed as $value ) {
			$result = SecretBox::decrypt( $value, $this->key );
			$this->assertSame( SecretReadResult::UNRECOVERABLE, $result->status(), $value );
			$this->assertNull( $result->value() );
		}
	}

	/** Other key material (rotated keys, another site) cannot decrypt. */
	public function test_wrong_key_is_unrecoverable(): void {
		$envelope = SecretBox::encrypt( 'access_live_secret', $this->key );
		$other    = SecretBox::derive_key( 'rotated-security-keys', 'test-context' );

		$this->assertSame( SecretReadResult::UNRECOVERABLE, SecretBox::decrypt( $envelope, $other )->status() );
	}

	/** A value encrypted for one context cannot be read in another. */
	public function test_context_mismatch_is_unrecoverable(): void {
		$envelope = SecretBox::encrypt( 'access_live_secret', $this->key );
		$other    = SecretBox::derive_key( 'site-security-keys', 'another-context' );

		$this->assertSame( SecretReadResult::UNRECOVERABLE, SecretBox::decrypt( $envelope, $other )->status() );
	}

	/** Without key material there is no key, and an envelope is temporarily unreadable. */
	public function test_missing_key_material(): void {
		$this->assertNull( SecretBox::derive_key( '', 'test-context' ) );
		$this->assertNull( SecretBox::encrypt( 'x', null ) );

		$envelope = SecretBox::encrypt( 'x', $this->key );
		$this->assertSame( SecretReadResult::UNSUPPORTED, SecretBox::decrypt( $envelope, null )->status() );
	}

	/** Non-string input is not encrypted. */
	public function test_non_string_is_not_encrypted(): void {
		$this->assertNull( SecretBox::encrypt( 42, $this->key ) );
		$this->assertNull( SecretBox::encrypt( 'x', 'short-key' ) );
	}
}
