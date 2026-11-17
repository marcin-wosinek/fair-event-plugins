<?php
/**
 * Tests for SignupPaymentSession.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

// phpcs:disable WordPress.Security.ValidatedSanitizedInput -- tests inspect the raw request cookies the code under test writes.

require_once dirname( __DIR__ ) . '/Shared/fixtures/session-cookie-stubs.php';

use FairEvents\Services\SignupPaymentSession;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Covers the payment session's cookie format, lifetimes, and rejections.
 */
class SignupPaymentSessionTest extends TestCase {

	/**
	 * Reset the cookie stubs before each test.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_setcookie_calls']  = array();
		$GLOBALS['_fair_test_headers_sent']     = false;
		$GLOBALS['_fair_test_setcookie_result'] = true;
		$GLOBALS['_fair_test_is_ssl']           = false;
		$_COOKIE                                = array();
	}

	/**
	 * Build a cookie value the way existing releases do.
	 *
	 * @param string $data    Signed payload.
	 * @param string $context Signing context.
	 * @return string
	 */
	private static function signed( string $data, string $context = 'fair_events_signup_payment_' ): string {
		return $data . '.' . hash_hmac( 'sha256', $data, $context . wp_salt( 'auth' ) );
	}

	/**
	 * Setting sends the payment cookie with the default 15-minute lifetime.
	 *
	 * @return void
	 */
	public function test_set_sends_cookie_with_default_lifetime() {
		SignupPaymentSession::set( 12, 34 );

		$calls = $GLOBALS['_fair_test_setcookie_calls'];
		$this->assertCount( 1, $calls );
		$this->assertSame( 'fair_events_signup_payment', $calls[0]['name'] );
		$this->assertEqualsWithDelta( time() + 15 * MINUTE_IN_SECONDS, $calls[0]['options']['expires'], 2 );
		$this->assertSame( '/', $calls[0]['options']['path'] );
		$this->assertTrue( $calls[0]['options']['httponly'] );
		$this->assertSame( 'Lax', $calls[0]['options']['samesite'] );

		$expires_at = $calls[0]['options']['expires'];
		$this->assertSame( self::signed( '12.34.' . $expires_at ), $calls[0]['value'] );
		$this->assertSame( $calls[0]['value'], $_COOKIE['fair_events_signup_payment'] );
		$this->assertSame(
			array(
				'signup_id'      => 12,
				'transaction_id' => 34,
			),
			SignupPaymentSession::get()
		);
	}

	/**
	 * A caller-supplied lifetime sets the signed expiry.
	 *
	 * @return void
	 */
	public function test_set_honours_custom_lifetime() {
		SignupPaymentSession::set( 12, 34, 2 * HOUR_IN_SECONDS );

		$call = $GLOBALS['_fair_test_setcookie_calls'][0];
		$this->assertEqualsWithDelta( time() + 2 * HOUR_IN_SECONDS, $call['options']['expires'], 2 );
		$this->assertStringContainsString( '.' . $call['options']['expires'] . '.', $call['value'] );
	}

	/**
	 * Invalid IDs never send a cookie.
	 *
	 * @return void
	 */
	public function test_set_ignores_invalid_ids() {
		SignupPaymentSession::set( 0, 34 );
		SignupPaymentSession::set( 12, -1 );

		$this->assertSame( array(), $GLOBALS['_fair_test_setcookie_calls'] );
		$this->assertArrayNotHasKey( 'fair_events_signup_payment', $_COOKIE );
	}

	/**
	 * Once headers are sent, setting changes nothing.
	 *
	 * @return void
	 */
	public function test_set_after_headers_sent_does_nothing() {
		$GLOBALS['_fair_test_headers_sent'] = true;

		SignupPaymentSession::set( 12, 34 );

		$this->assertSame( array(), $GLOBALS['_fair_test_setcookie_calls'] );
		$this->assertArrayNotHasKey( 'fair_events_signup_payment', $_COOKIE );
	}

	/**
	 * A cookie written by an existing release is still accepted.
	 *
	 * @return void
	 */
	public function test_get_accepts_existing_format_cookie() {
		$_COOKIE['fair_events_signup_payment'] = self::signed( '5.7.' . ( time() + 60 ) );

		$this->assertSame(
			array(
				'signup_id'      => 5,
				'transaction_id' => 7,
			),
			SignupPaymentSession::get()
		);
	}

	/**
	 * Cookie values that must be rejected.
	 *
	 * @return array<string, array{0: mixed}>
	 */
	public static function rejected_cookies(): array {
		$future = time() + 600;
		$valid  = self::signed( '5.7.' . $future );

		return array(
			'empty'                        => array( '' ),
			'non-string'                   => array( array( 'x' ) ),
			'too few parts'                => array( self::signed( '5.' . $future ) ),
			'non-numeric id'               => array( self::signed( 'a.7.' . $future ) ),
			'zero signup id'               => array( self::signed( '0.7.' . $future ) ),
			'zero transaction id'          => array( self::signed( '5.0.' . $future ) ),
			'expired'                      => array( self::signed( '5.7.' . ( time() - 1 ) ) ),
			'tampered signature'           => array( substr( $valid, 0, -1 ) . ( '0' === substr( $valid, -1 ) ? '1' : '0' ) ),
			'tampered transaction'         => array( str_replace( '5.7.', '5.8.', $valid ) ),
			'extended expiry'              => array( str_replace( '.' . $future . '.', '.' . ( $future + 3600 ) . '.', $valid ) ),
			'audience-shaped cookie'       => array( self::signed( '5.' . $future, 'fair_audience_session_' ) ),
			'signed with audience context' => array( self::signed( '5.7.' . $future, 'fair_audience_session_' ) ),
		);
	}

	/**
	 * Missing, malformed, expired, tampered, and cross-purpose cookies are rejected.
	 *
	 * @param mixed $value Cookie value.
	 * @return void
	 */
	#[DataProvider( 'rejected_cookies' )]
	public function test_get_rejects_invalid_cookie( $value ) {
		$_COOKIE['fair_events_signup_payment'] = $value;

		$this->assertNull( SignupPaymentSession::get() );
	}

	/**
	 * A missing cookie yields no session.
	 *
	 * @return void
	 */
	public function test_get_without_cookie_returns_null() {
		$this->assertNull( SignupPaymentSession::get() );
	}

	/**
	 * Clearing expires only the payment cookie.
	 *
	 * @return void
	 */
	public function test_clear_leaves_audience_session_alone() {
		$_COOKIE['fair_events_signup_payment'] = self::signed( '5.7.' . ( time() + 60 ) );
		$_COOKIE['fair_audience_session']      = 'keep';

		SignupPaymentSession::clear();

		$calls = $GLOBALS['_fair_test_setcookie_calls'];
		$this->assertCount( 1, $calls );
		$this->assertSame( 'fair_events_signup_payment', $calls[0]['name'] );
		$this->assertSame( '', $calls[0]['value'] );
		$this->assertLessThan( time(), $calls[0]['options']['expires'] );
		$this->assertArrayNotHasKey( 'fair_events_signup_payment', $_COOKIE );
		$this->assertSame( 'keep', $_COOKIE['fair_audience_session'] );
	}

	/**
	 * Once headers are sent, clearing still ends the session for this request.
	 *
	 * @return void
	 */
	public function test_clear_after_headers_sent_removes_entry_only() {
		$GLOBALS['_fair_test_headers_sent']    = true;
		$_COOKIE['fair_events_signup_payment'] = self::signed( '5.7.' . ( time() + 60 ) );

		SignupPaymentSession::clear();

		$this->assertSame( array(), $GLOBALS['_fair_test_setcookie_calls'] );
		$this->assertNull( SignupPaymentSession::get() );
	}
}
