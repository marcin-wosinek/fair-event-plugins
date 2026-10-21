<?php
/**
 * InstagramCredentials status and conversion tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Settings;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Security\ProtectedOptions;
use FairEventsShared\Security\SecretBox;
use FairAudience\Settings\InstagramCredentials;

require_once __DIR__ . '/Fair_Test_Options_WPDB.php';

/**
 * Unit tests for the Instagram credential status, the one-time conversion
 * and disconnecting while the token is unreadable.
 */
class InstagramCredentialsTest extends TestCase {

	/**
	 * Previous $wpdb.
	 *
	 * @var mixed
	 */
	private $previous_wpdb;

	/**
	 * A connected site with a plaintext token, encryption supported.
	 */
	protected function setUp(): void {
		parent::setUp();
		global $wpdb;
		$this->previous_wpdb           = $wpdb;
		$wpdb                          = new Fair_Test_Options_WPDB(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$GLOBALS['_fair_test_filters'] = array();
		$GLOBALS['_fair_test_options'] = array(
			InstagramCredentials::CONNECTED_OPTION => true,
			InstagramCredentials::OPTION           => 'instagram_plain',
		);
		unset( $GLOBALS['_fair_test_salt'] );
	}

	/**
	 * Restore globals.
	 */
	protected function tearDown(): void {
		global $wpdb;
		$wpdb                          = $this->previous_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$GLOBALS['_fair_test_filters'] = array();
		$GLOBALS['_fair_test_options'] = array();
		unset( $GLOBALS['_fair_test_salt'] );
		parent::tearDown();
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

	/**
	 * Encrypt the stored token.
	 */
	private function encrypt_token() {
		$GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ] = ProtectedOptions::filter_write( $GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ], InstagramCredentials::OPTION );
	}

	/** A plaintext token is available and the account counts as connected. */
	public function test_plaintext_token_is_available(): void {
		$this->assertSame( InstagramCredentials::AVAILABLE, InstagramCredentials::status() );
		$this->assertTrue( InstagramCredentials::is_connected() );
		$this->assertFalse( InstagramCredentials::is_encrypted() );
		$this->assertSame( '', InstagramCredentials::admin_message( InstagramCredentials::AVAILABLE ) );
	}

	/** An encrypted token is available and reported as encrypted. */
	public function test_encrypted_token_is_available(): void {
		$this->encrypt_token();

		$this->assertTrue( SecretBox::is_envelope( $GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ] ) );
		$this->assertSame( InstagramCredentials::AVAILABLE, InstagramCredentials::status() );
		$this->assertTrue( InstagramCredentials::is_connected() );
		$this->assertTrue( InstagramCredentials::is_encrypted() );
	}

	/** Without the stored flag, a readable token does not make Instagram connected. */
	public function test_connection_flag_decides_when_token_is_readable(): void {
		$GLOBALS['_fair_test_options'][ InstagramCredentials::CONNECTED_OPTION ] = false;

		$this->assertSame( InstagramCredentials::AVAILABLE, InstagramCredentials::status() );
		$this->assertFalse( InstagramCredentials::is_connected() );
	}

	/** Lost support pauses Instagram without clearing the stored flag or token. */
	public function test_support_loss_makes_token_temporarily_unavailable(): void {
		$this->encrypt_token();
		$envelope = $GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ];
		$this->set_supported( false );

		$this->assertSame( InstagramCredentials::ENCRYPTION_UNAVAILABLE, InstagramCredentials::status() );
		$this->assertFalse( InstagramCredentials::is_connected() );
		$this->assertFalse( InstagramCredentials::can_store() );
		$this->assertTrue( $GLOBALS['_fair_test_options'][ InstagramCredentials::CONNECTED_OPTION ] );
		$this->assertSame( $envelope, $GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ] );
		$this->assertNotSame( '', InstagramCredentials::admin_message( InstagramCredentials::ENCRYPTION_UNAVAILABLE ) );

		$this->set_supported( true );
		$this->assertTrue( InstagramCredentials::is_connected() );
	}

	/** Without support, a plaintext token keeps working and can be rewritten. */
	public function test_plaintext_token_works_without_support(): void {
		$this->set_supported( false );

		$this->assertSame( InstagramCredentials::AVAILABLE, InstagramCredentials::status() );
		$this->assertTrue( InstagramCredentials::can_store() );
		$this->assertTrue( InstagramCredentials::is_connected() );
	}

	/** Changed security keys make the token unrecoverable, and it stays stored. */
	public function test_changed_keys_make_token_unrecoverable(): void {
		$this->encrypt_token();
		$envelope                   = $GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ];
		$GLOBALS['_fair_test_salt'] = 'rotated-security-keys';

		$this->assertSame( InstagramCredentials::UNRECOVERABLE, InstagramCredentials::status() );
		$this->assertFalse( InstagramCredentials::is_connected() );
		$this->assertTrue( InstagramCredentials::can_store() );
		$this->assertSame( $envelope, $GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ] );
		$this->assertNotSame( '', InstagramCredentials::admin_message( InstagramCredentials::UNRECOVERABLE ) );
	}

	/** A replacement token can be stored over an unrecoverable one. */
	public function test_replacing_an_unrecoverable_token(): void {
		$this->encrypt_token();
		$GLOBALS['_fair_test_salt'] = 'rotated-security-keys';

		$stored = ProtectedOptions::filter_write( 'instagram_new', InstagramCredentials::OPTION );

		$this->assertFalse( InstagramCredentials::last_write_failed() );
		$this->assertTrue( SecretBox::is_envelope( $stored ) );
		$GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ] = $stored;
		$this->assertSame( InstagramCredentials::AVAILABLE, InstagramCredentials::status() );
	}

	/** Disconnecting removes an unreadable token that an empty write would skip. */
	public function test_empty_write_clears_unreadable_token(): void {
		$this->encrypt_token();
		$GLOBALS['_fair_test_salt'] = 'rotated-security-keys';

		$this->assertTrue( InstagramCredentials::clear_unreadable_token( false, InstagramCredentials::OPTION, '' ) );
		$this->assertArrayNotHasKey( InstagramCredentials::OPTION, $GLOBALS['_fair_test_options'] );
	}

	/** Other writes go through the ordinary settings update. */
	public function test_other_writes_are_not_intercepted(): void {
		$this->encrypt_token();

		// Readable token: the ordinary update clears it.
		$this->assertFalse( InstagramCredentials::clear_unreadable_token( false, InstagramCredentials::OPTION, '' ) );

		$GLOBALS['_fair_test_salt'] = 'rotated-security-keys';
		$this->assertFalse( InstagramCredentials::clear_unreadable_token( false, InstagramCredentials::OPTION, 'instagram_new' ) );
		$this->assertFalse( InstagramCredentials::clear_unreadable_token( false, 'fair_audience_instagram_user_id', '' ) );
		$this->assertTrue( InstagramCredentials::clear_unreadable_token( true, InstagramCredentials::OPTION, '' ) );
		$this->assertArrayHasKey( InstagramCredentials::OPTION, $GLOBALS['_fair_test_options'] );
	}

	/** The conversion encrypts the token and records that it is done. */
	public function test_maybe_convert_encrypts_and_completes(): void {
		InstagramCredentials::maybe_convert();

		$this->assertTrue( SecretBox::is_envelope( $GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ] ) );
		$this->assertSame( 1, $GLOBALS['_fair_test_options'][ InstagramCredentials::CONVERSION_OPTION ] );
		$this->assertTrue( InstagramCredentials::is_encrypted() );
		$this->assertTrue( InstagramCredentials::is_connected() );
	}

	/** Without support the conversion is deferred to a later request. */
	public function test_maybe_convert_is_deferred_without_support(): void {
		$this->set_supported( false );

		InstagramCredentials::maybe_convert();

		$this->assertSame( 'instagram_plain', $GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ] );
		$this->assertArrayNotHasKey( InstagramCredentials::CONVERSION_OPTION, $GLOBALS['_fair_test_options'] );

		$this->set_supported( true );
		InstagramCredentials::maybe_convert();

		$this->assertTrue( SecretBox::is_envelope( $GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ] ) );
		$this->assertSame( 1, $GLOBALS['_fair_test_options'][ InstagramCredentials::CONVERSION_OPTION ] );
	}

	/** A site without a token completes the conversion at once. */
	public function test_maybe_convert_completes_without_token(): void {
		unset( $GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ] );

		InstagramCredentials::maybe_convert();

		$this->assertSame( 1, $GLOBALS['_fair_test_options'][ InstagramCredentials::CONVERSION_OPTION ] );
	}

	/** Once complete, the conversion does not run again. */
	public function test_maybe_convert_runs_once(): void {
		$GLOBALS['_fair_test_options'][ InstagramCredentials::CONVERSION_OPTION ] = 1;

		InstagramCredentials::maybe_convert();

		$this->assertSame( 'instagram_plain', $GLOBALS['_fair_test_options'][ InstagramCredentials::OPTION ] );
	}
}
