<?php
/**
 * FairEventsShared\Security\ProtectedOptions tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Shared;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Security\ProtectedOptions;
use FairEventsShared\Security\SecretBox;
use FairEventsShared\Security\SecretReadResult;

require_once __DIR__ . '/Fair_Test_Options_WPDB.php';

/**
 * Unit tests for transparent option encryption. The bootstrap's option
 * stubs hold the raw stored values; the filter callbacks are driven
 * directly, as WordPress would call them.
 */
class ProtectedOptionsTest extends TestCase {

	const OPTION = 'fair_test_protected_secret';

	/**
	 * Previous $wpdb.
	 *
	 * @var mixed
	 */
	private $previous_wpdb;

	/**
	 * Reset stored options, key material and encryption support.
	 */
	protected function setUp(): void {
		parent::setUp();
		global $wpdb;
		$this->previous_wpdb           = $wpdb;
		$wpdb                          = new Fair_Test_Options_WPDB(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$GLOBALS['_fair_test_options'] = array();
		$GLOBALS['_fair_test_filters'] = array();
		unset( $GLOBALS['_fair_test_salt'] );
	}

	/**
	 * Restore globals.
	 */
	protected function tearDown(): void {
		global $wpdb;
		$wpdb                          = $this->previous_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$GLOBALS['_fair_test_filters'] = array();
		unset( $GLOBALS['_fair_test_salt'] );
		parent::tearDown();
	}

	/**
	 * Store a value the way add_option()/update_option() would.
	 *
	 * @param string $value  Value.
	 * @param string $option Option name.
	 */
	private function store( $value, $option = self::OPTION ) {
		$GLOBALS['_fair_test_options'][ $option ] = ProtectedOptions::filter_write( $value, $option );
	}

	/**
	 * Read a value the way get_option() would.
	 *
	 * @param string $option Option name.
	 * @return mixed
	 */
	private function get( $option = self::OPTION ) {
		return ProtectedOptions::filter_read( $GLOBALS['_fair_test_options'][ $option ] ?? false, $option );
	}

	/**
	 * Switch encryption support.
	 *
	 * @param bool $supported Whether it is available.
	 */
	private function set_supported( $supported ) {
		$GLOBALS['_fair_test_filters'][ ProtectedOptions::SUPPORT_FILTER ] = static function () use ( $supported ) {
			return $supported;
		};
	}

	/** A stored secret is an envelope; reading returns the plaintext. */
	public function test_write_encrypts_and_read_decrypts(): void {
		$this->store( 'access_live_secret' );

		$raw = $GLOBALS['_fair_test_options'][ self::OPTION ];
		$this->assertStringStartsWith( SecretBox::PREFIX, $raw );
		$this->assertStringNotContainsString( 'access_live_secret', $raw );
		$this->assertSame( 'access_live_secret', $this->get() );

		$read = ProtectedOptions::read( self::OPTION );
		$this->assertTrue( $read->is_readable() );
		$this->assertTrue( $read->is_encrypted() );
		$this->assertSame( 'access_live_secret', $read->value() );
	}

	/** Empty values and envelopes are stored as given — never double-encrypted. */
	public function test_empty_and_envelope_values_are_stored_as_given(): void {
		$this->assertSame( '', ProtectedOptions::filter_write( '', self::OPTION ) );

		$this->store( 'access_live_secret' );
		$envelope = $GLOBALS['_fair_test_options'][ self::OPTION ];

		$this->assertSame( $envelope, ProtectedOptions::filter_write( $envelope, self::OPTION ) );
	}

	/** Plaintext stored before protection stays readable. */
	public function test_legacy_plaintext_is_readable(): void {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = 'legacy_plain';

		$this->assertSame( 'legacy_plain', $this->get() );
		$this->assertFalse( ProtectedOptions::read( self::OPTION )->is_encrypted() );
	}

	/** Without support, new plaintext secrets keep the plaintext storage. */
	public function test_plaintext_fallback_without_support(): void {
		$this->set_supported( false );

		$this->store( 'refresh_plain' );

		$this->assertSame( 'refresh_plain', $GLOBALS['_fair_test_options'][ self::OPTION ] );
		$this->assertSame( 'refresh_plain', $this->get() );
		$this->assertFalse( ProtectedOptions::last_write_failed( self::OPTION ) );
		$this->assertTrue( ProtectedOptions::can_store( self::OPTION ) );
	}

	/** Losing support never replaces an envelope with plaintext, and the envelope reads as unavailable. */
	public function test_support_loss_preserves_envelope(): void {
		$this->store( 'access_live_secret' );
		$envelope = $GLOBALS['_fair_test_options'][ self::OPTION ];

		$this->set_supported( false );

		$this->assertSame( '', $this->get() );
		$this->assertSame( SecretReadResult::UNSUPPORTED, ProtectedOptions::read( self::OPTION )->status() );
		$this->assertFalse( ProtectedOptions::can_store( self::OPTION ) );

		$this->store( 'access_new_plain' );

		$this->assertSame( $envelope, $GLOBALS['_fair_test_options'][ self::OPTION ] );
		$this->assertTrue( ProtectedOptions::last_write_failed( self::OPTION ) );
	}

	/** Restoring support recovers the preserved value. */
	public function test_restoring_support_recovers_value(): void {
		$this->store( 'access_live_secret' );
		$this->set_supported( false );
		$this->assertSame( '', $this->get() );

		$this->set_supported( true );

		$this->assertSame( 'access_live_secret', $this->get() );
		$this->assertTrue( ProtectedOptions::read( self::OPTION )->is_readable() );
	}

	/** Changed security keys make the value unrecoverable; it stays stored. */
	public function test_changed_keys_make_value_unrecoverable(): void {
		$this->store( 'access_live_secret' );
		$envelope = $GLOBALS['_fair_test_options'][ self::OPTION ];

		$GLOBALS['_fair_test_salt'] = 'rotated-security-keys';

		$this->assertSame( '', $this->get() );
		$this->assertSame( SecretReadResult::UNRECOVERABLE, ProtectedOptions::read( self::OPTION )->status() );
		$this->assertSame( $envelope, $GLOBALS['_fair_test_options'][ self::OPTION ] );

		// A new connection replaces it.
		$this->store( 'access_reconnected' );
		$this->assertSame( 'access_reconnected', $this->get() );
	}

	/** An envelope copied into another option cannot be read there. */
	public function test_option_context_mismatch_is_unrecoverable(): void {
		$this->store( 'access_live_secret' );
		$GLOBALS['_fair_test_options']['fair_test_other_secret'] = $GLOBALS['_fair_test_options'][ self::OPTION ];

		$this->assertSame( SecretReadResult::UNRECOVERABLE, ProtectedOptions::read( 'fair_test_other_secret' )->status() );
	}

	/** A tampered stored value reads as unrecoverable, never as ciphertext. */
	public function test_tampered_value_is_unrecoverable(): void {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = SecretBox::PREFIX . 'garbage';

		$this->assertSame( '', $this->get() );
		$this->assertSame( SecretReadResult::UNRECOVERABLE, ProtectedOptions::read( self::OPTION )->status() );
	}

	/** Conversion encrypts plaintext in place, and is idempotent. */
	public function test_convert_encrypts_plaintext_once(): void {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = 'legacy_plain';

		$this->assertSame( ProtectedOptions::CONVERTED, ProtectedOptions::convert( self::OPTION ) );
		$envelope = $GLOBALS['_fair_test_options'][ self::OPTION ];
		$this->assertTrue( SecretBox::is_envelope( $envelope ) );
		$this->assertSame( 'legacy_plain', $this->get() );

		$this->assertSame( ProtectedOptions::ENCRYPTED, ProtectedOptions::convert( self::OPTION ) );
		$this->assertSame( $envelope, $GLOBALS['_fair_test_options'][ self::OPTION ] );
	}

	/** Nothing to convert for a missing or empty value. */
	public function test_convert_empty(): void {
		$this->assertSame( ProtectedOptions::EMPTY_VALUE, ProtectedOptions::convert( self::OPTION ) );

		$GLOBALS['_fair_test_options'][ self::OPTION ] = '';
		$this->assertSame( ProtectedOptions::EMPTY_VALUE, ProtectedOptions::convert( self::OPTION ) );
	}

	/** Without support, conversion is deferred and the plaintext kept. */
	public function test_convert_deferred_without_support(): void {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = 'legacy_plain';
		$this->set_supported( false );

		$this->assertSame( ProtectedOptions::UNSUPPORTED, ProtectedOptions::convert( self::OPTION ) );
		$this->assertSame( 'legacy_plain', $GLOBALS['_fair_test_options'][ self::OPTION ] );
	}

	/** A value changed concurrently is not overwritten by the conversion. */
	public function test_convert_never_overwrites_a_concurrent_change(): void {
		global $wpdb;
		$GLOBALS['_fair_test_options'][ self::OPTION ] = 'legacy_plain';
		$wpdb->concurrent_write                        = 'rotated_by_checkout';

		$this->assertSame( ProtectedOptions::CHANGED, ProtectedOptions::convert( self::OPTION ) );
		$this->assertSame( 'rotated_by_checkout', $GLOBALS['_fair_test_options'][ self::OPTION ] );
	}
}
