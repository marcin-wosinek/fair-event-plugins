<?php
/**
 * TelegramCredentials status and conversion tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Settings;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Security\ProtectedOptions;
use FairEventsShared\Security\SecretBox;
use FairPaymentsConnector\Services\TelegramChannel;
use FairPaymentsConnector\Services\TelegramService;
use FairPaymentsConnector\Settings\TelegramCredentials;
use FairPaymentsConnector\Tests\Shared\Fair_Test_Options_WPDB;

require_once dirname( __DIR__ ) . '/Shared/Fair_Test_Options_WPDB.php';

/**
 * Unit tests for the Telegram bot token status, its one-time conversion, and
 * the delivery channel's handling of an unreadable token.
 */
class TelegramCredentialsTest extends TestCase {

	/**
	 * Previous $wpdb.
	 *
	 * @var mixed
	 */
	private $previous_wpdb;

	/**
	 * A plaintext bot token, encryption supported, and option reads decrypted
	 * the way the `option_{$name}` filter does it.
	 */
	protected function setUp(): void {
		parent::setUp();
		global $wpdb;
		$this->previous_wpdb                  = $wpdb;
		$wpdb                                 = new Fair_Test_Options_WPDB(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$GLOBALS['_fair_test_filters']        = array();
		$GLOBALS['_fair_test_option_filters'] = array(
			'read' => array( ProtectedOptions::class, 'filter_read' ),
		);
		$GLOBALS['_fair_test_options']        = array(
			TelegramCredentials::OPTION => '123456:telegram_plain',
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
		unset( $GLOBALS['_fair_test_option_filters'], $GLOBALS['_fair_test_salt'] );
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
		$GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ] = ProtectedOptions::filter_write( $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ], TelegramCredentials::OPTION );
	}

	/**
	 * A channel whose sender must not be called.
	 *
	 * @return TelegramChannel
	 */
	private function channel_that_must_not_send() {
		$telegram = $this->createMock( TelegramService::class );
		$telegram->expects( $this->never() )->method( 'send' );
		return new TelegramChannel( $telegram );
	}

	/** A plaintext token is available and readable as is. */
	public function test_plaintext_token_is_available(): void {
		$this->assertSame( TelegramCredentials::AVAILABLE, TelegramCredentials::status() );
		$this->assertSame( '123456:telegram_plain', TelegramCredentials::token() );
		$this->assertFalse( TelegramCredentials::is_encrypted() );
	}

	/** No stored token is reported as missing, not as a credential failure. */
	public function test_missing_token(): void {
		$GLOBALS['_fair_test_options'] = array();

		$this->assertSame( TelegramCredentials::MISSING, TelegramCredentials::status() );
		$this->assertSame( '', TelegramCredentials::token() );
		$this->assertFalse( TelegramCredentials::is_encrypted() );
	}

	/** An encrypted token reads back decrypted, for the settings screen too. */
	public function test_encrypted_token_reads_back_decrypted(): void {
		$this->encrypt_token();

		$this->assertTrue( SecretBox::is_envelope( $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ] ) );
		$this->assertStringNotContainsString( 'telegram_plain', $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ] );
		$this->assertSame( TelegramCredentials::AVAILABLE, TelegramCredentials::status() );
		$this->assertSame( '123456:telegram_plain', get_option( TelegramCredentials::OPTION ) );
		$this->assertTrue( TelegramCredentials::is_encrypted() );
	}

	/** The channel sends with the decrypted token. */
	public function test_channel_sends_with_decrypted_token(): void {
		$this->encrypt_token();
		$telegram = $this->createMock( TelegramService::class );
		$telegram->expects( $this->once() )
			->method( 'send' )
			->with( '123456:telegram_plain', '42', 'Hello' )
			->willReturn( array( 'ok' => true ) );

		$this->assertTrue( ( new TelegramChannel( $telegram ) )->send( '42', 'Hello' ) );
	}

	/** Lost support keeps the token stored and pauses deliveries until it returns. */
	public function test_support_loss_makes_token_temporarily_unavailable(): void {
		$this->encrypt_token();
		$envelope = $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ];
		$this->set_supported( false );

		$this->assertSame( TelegramCredentials::ENCRYPTION_UNAVAILABLE, TelegramCredentials::status() );
		$this->assertSame( '', TelegramCredentials::token() );
		$this->assertFalse( TelegramCredentials::can_store() );
		$this->assertFalse( $this->channel_that_must_not_send()->send( '42', 'Hello' ) );
		$this->assertSame( $envelope, $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ] );
		$this->assertNotSame( '', TelegramCredentials::admin_message( TelegramCredentials::ENCRYPTION_UNAVAILABLE ) );

		$this->set_supported( true );
		$this->assertSame( TelegramCredentials::AVAILABLE, TelegramCredentials::status() );
		$this->assertSame( '123456:telegram_plain', TelegramCredentials::token() );
	}

	/** A replacement written without support is refused over an envelope. */
	public function test_replacement_without_support_is_not_stored(): void {
		$this->encrypt_token();
		$envelope = $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ];
		$this->set_supported( false );

		$stored = ProtectedOptions::filter_write( '123456:telegram_new', TelegramCredentials::OPTION );

		$this->assertSame( $envelope, $stored );
		$this->assertTrue( TelegramCredentials::last_write_failed() );
	}

	/** Without support, a plaintext token keeps working and can be rewritten. */
	public function test_plaintext_token_works_without_support(): void {
		$this->set_supported( false );

		$this->assertSame( TelegramCredentials::AVAILABLE, TelegramCredentials::status() );
		$this->assertTrue( TelegramCredentials::can_store() );
		$this->assertSame( '123456:telegram_plain', TelegramCredentials::token() );
	}

	/** Changed security keys make the token unrecoverable; it stays stored and deliveries fail. */
	public function test_changed_keys_make_token_unrecoverable(): void {
		$this->encrypt_token();
		$envelope                   = $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ];
		$GLOBALS['_fair_test_salt'] = 'rotated-security-keys';

		$this->assertSame( TelegramCredentials::UNRECOVERABLE, TelegramCredentials::status() );
		$this->assertSame( '', TelegramCredentials::token() );
		$this->assertTrue( TelegramCredentials::can_store() );
		$this->assertFalse( $this->channel_that_must_not_send()->send( '42', 'Hello' ) );
		$this->assertSame( $envelope, $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ] );
		$this->assertNotSame( '', TelegramCredentials::admin_message( TelegramCredentials::UNRECOVERABLE ) );
		$this->assertSame( '', TelegramCredentials::admin_message( TelegramCredentials::AVAILABLE ) );
	}

	/** The conversion encrypts the token and records that it is done. */
	public function test_maybe_convert_encrypts_and_completes(): void {
		TelegramCredentials::maybe_convert();

		$this->assertTrue( SecretBox::is_envelope( $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ] ) );
		$this->assertSame( 1, $GLOBALS['_fair_test_options'][ TelegramCredentials::CONVERSION_OPTION ] );
		$this->assertSame( '123456:telegram_plain', TelegramCredentials::token() );
	}

	/** Without support the conversion is deferred to a later request. */
	public function test_maybe_convert_is_deferred_without_support(): void {
		$this->set_supported( false );

		TelegramCredentials::maybe_convert();

		$this->assertSame( '123456:telegram_plain', $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ] );
		$this->assertArrayNotHasKey( TelegramCredentials::CONVERSION_OPTION, $GLOBALS['_fair_test_options'] );

		$this->set_supported( true );
		TelegramCredentials::maybe_convert();

		$this->assertTrue( SecretBox::is_envelope( $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ] ) );
		$this->assertSame( 1, $GLOBALS['_fair_test_options'][ TelegramCredentials::CONVERSION_OPTION ] );
	}

	/** A conversion racing a concurrent write leaves the new value and completes. */
	public function test_maybe_convert_never_overwrites_a_concurrent_write(): void {
		global $wpdb;
		$wpdb->concurrent_write = '123456:telegram_concurrent';

		TelegramCredentials::maybe_convert();

		$this->assertSame( '123456:telegram_concurrent', $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ] );
		$this->assertSame( 1, $GLOBALS['_fair_test_options'][ TelegramCredentials::CONVERSION_OPTION ] );
	}

	/** Once complete, the conversion does not run again. */
	public function test_maybe_convert_runs_once(): void {
		$GLOBALS['_fair_test_options'][ TelegramCredentials::CONVERSION_OPTION ] = 1;

		TelegramCredentials::maybe_convert();

		$this->assertSame( '123456:telegram_plain', $GLOBALS['_fair_test_options'][ TelegramCredentials::OPTION ] );
	}
}
