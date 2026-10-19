<?php
/**
 * MollieCredentials status and conversion tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Payment;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Security\ProtectedOptions;
use FairEventsShared\Security\SecretBox;
use FairPaymentsConnector\Payment\MollieCredentials;
use FairPaymentsConnector\Payment\MolliePaymentHandler;
use FairPaymentsConnector\Tests\Shared\Fair_Test_Options_WPDB;

require_once dirname( __DIR__ ) . '/Shared/Fair_Test_Options_WPDB.php';

/**
 * Unit tests for the Mollie credential status and the one-time conversion.
 */
class MollieCredentialsTest extends TestCase {

	/**
	 * Previous $wpdb.
	 *
	 * @var mixed
	 */
	private $previous_wpdb;

	/**
	 * A connected site with plaintext tokens, encryption supported.
	 */
	protected function setUp(): void {
		parent::setUp();
		global $wpdb;
		$this->previous_wpdb           = $wpdb;
		$wpdb                          = new Fair_Test_Options_WPDB(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$GLOBALS['_fair_test_filters'] = array();
		$GLOBALS['_fair_test_options'] = array(
			'fair_payment_mollie_connected'     => true,
			'fair_payment_mollie_access_token'  => 'access_plain',
			'fair_payment_mollie_refresh_token' => 'refresh_plain',
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
	 * Encrypt both stored tokens.
	 */
	private function encrypt_tokens() {
		foreach ( MollieCredentials::OPTIONS as $option ) {
			$GLOBALS['_fair_test_options'][ $option ] = ProtectedOptions::filter_write( $GLOBALS['_fair_test_options'][ $option ], $option );
		}
	}

	/** Plaintext tokens are available, and the site counts as configured. */
	public function test_plaintext_tokens_are_available(): void {
		$this->assertSame( MollieCredentials::AVAILABLE, MollieCredentials::status() );
		$this->assertFalse( MollieCredentials::is_encrypted() );
		$this->assertTrue( MolliePaymentHandler::is_configured() );
	}

	/** Missing tokens are not a credential problem — the connection flag decides. */
	public function test_missing_tokens_are_available(): void {
		$GLOBALS['_fair_test_options'] = array();

		$this->assertSame( MollieCredentials::AVAILABLE, MollieCredentials::status() );
		$this->assertFalse( MollieCredentials::is_encrypted() );
		$this->assertFalse( MolliePaymentHandler::is_configured() );
	}

	/** Encrypted tokens are available and reported as encrypted. */
	public function test_encrypted_tokens_are_available(): void {
		$this->encrypt_tokens();

		$this->assertSame( MollieCredentials::AVAILABLE, MollieCredentials::status() );
		$this->assertTrue( MollieCredentials::is_encrypted() );
		$this->assertTrue( MolliePaymentHandler::is_configured() );
	}

	/** Lost support on encrypted tokens pauses payments without clearing the connection. */
	public function test_support_loss_makes_tokens_temporarily_unavailable(): void {
		$this->encrypt_tokens();
		$this->set_supported( false );

		$this->assertSame( MollieCredentials::ENCRYPTION_UNAVAILABLE, MollieCredentials::status() );
		$this->assertFalse( MolliePaymentHandler::is_configured() );
		$this->assertFalse( MollieCredentials::can_store() );
		$this->assertTrue( $GLOBALS['_fair_test_options']['fair_payment_mollie_connected'] );
		$this->assertNotSame( '', MollieCredentials::admin_message( MollieCredentials::ENCRYPTION_UNAVAILABLE ) );

		$this->set_supported( true );
		$this->assertTrue( MolliePaymentHandler::is_configured() );
	}

	/** Without support, plaintext tokens keep working and can be rewritten. */
	public function test_plaintext_tokens_work_without_support(): void {
		$this->set_supported( false );

		$this->assertSame( MollieCredentials::AVAILABLE, MollieCredentials::status() );
		$this->assertTrue( MollieCredentials::can_store() );
		$this->assertTrue( MolliePaymentHandler::is_configured() );
	}

	/** One unrecoverable token needs a reconnect, whatever the other token says. */
	public function test_unrecoverable_token_takes_precedence(): void {
		$this->encrypt_tokens();
		$GLOBALS['_fair_test_options']['fair_payment_mollie_refresh_token'] = SecretBox::PREFIX . 'corrupted';

		$this->assertSame( MollieCredentials::UNRECOVERABLE, MollieCredentials::status() );
		$this->assertFalse( MolliePaymentHandler::is_configured() );

		$this->set_supported( false );
		$this->assertSame( MollieCredentials::UNRECOVERABLE, MollieCredentials::status() );
	}

	/** Changed security keys make the tokens unrecoverable. */
	public function test_changed_keys_make_tokens_unrecoverable(): void {
		$this->encrypt_tokens();
		$GLOBALS['_fair_test_salt'] = 'rotated-security-keys';

		$this->assertSame( MollieCredentials::UNRECOVERABLE, MollieCredentials::status() );
		$this->assertNotSame( '', MollieCredentials::admin_message( MollieCredentials::UNRECOVERABLE ) );
		$this->assertSame( '', MollieCredentials::admin_message( MollieCredentials::AVAILABLE ) );
	}

	/** The conversion encrypts both tokens and records that it is done. */
	public function test_maybe_convert_encrypts_and_completes(): void {
		MollieCredentials::maybe_convert();

		$this->assertTrue( SecretBox::is_envelope( $GLOBALS['_fair_test_options']['fair_payment_mollie_access_token'] ) );
		$this->assertTrue( SecretBox::is_envelope( $GLOBALS['_fair_test_options']['fair_payment_mollie_refresh_token'] ) );
		$this->assertSame( 1, $GLOBALS['_fair_test_options'][ MollieCredentials::CONVERSION_OPTION ] );
		$this->assertTrue( MollieCredentials::is_encrypted() );
		$this->assertSame( MollieCredentials::AVAILABLE, MollieCredentials::status() );
	}

	/** Without support the conversion is deferred to a later request. */
	public function test_maybe_convert_is_deferred_without_support(): void {
		$this->set_supported( false );

		MollieCredentials::maybe_convert();

		$this->assertSame( 'access_plain', $GLOBALS['_fair_test_options']['fair_payment_mollie_access_token'] );
		$this->assertArrayNotHasKey( MollieCredentials::CONVERSION_OPTION, $GLOBALS['_fair_test_options'] );

		$this->set_supported( true );
		MollieCredentials::maybe_convert();

		$this->assertTrue( SecretBox::is_envelope( $GLOBALS['_fair_test_options']['fair_payment_mollie_access_token'] ) );
		$this->assertSame( 1, $GLOBALS['_fair_test_options'][ MollieCredentials::CONVERSION_OPTION ] );
	}

	/** Once complete, the conversion does not run again. */
	public function test_maybe_convert_runs_once(): void {
		$GLOBALS['_fair_test_options'][ MollieCredentials::CONVERSION_OPTION ] = 1;

		MollieCredentials::maybe_convert();

		$this->assertSame( 'access_plain', $GLOBALS['_fair_test_options']['fair_payment_mollie_access_token'] );
	}
}
