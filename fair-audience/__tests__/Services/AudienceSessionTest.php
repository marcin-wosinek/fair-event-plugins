<?php
/**
 * Tests for AudienceSession.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

// phpcs:disable WordPress.Security.ValidatedSanitizedInput -- tests inspect the raw request cookies the code under test writes.

require_once __DIR__ . '/fixtures/session-cookie-stubs.php';

use FairAudience\Services\AudienceSession;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Covers the participant session's cookie format, sliding refresh, and rejections.
 */
class AudienceSessionTest extends TestCase {

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
	private static function signed( string $data, string $context = 'fair_audience_session_' ): string {
		return $data . '.' . hash_hmac( 'sha256', $data, $context . wp_salt( 'auth' ) );
	}

	/**
	 * Setting sends the participant cookie with the one-hour lifetime.
	 *
	 * @return void
	 */
	public function test_set_sends_cookie_with_one_hour_lifetime() {
		$GLOBALS['_fair_test_is_ssl'] = true;

		AudienceSession::set( 42 );

		$calls = $GLOBALS['_fair_test_setcookie_calls'];
		$this->assertCount( 1, $calls );
		$this->assertSame( 'fair_audience_session', $calls[0]['name'] );
		$this->assertEqualsWithDelta( time() + HOUR_IN_SECONDS, $calls[0]['options']['expires'], 2 );
		$this->assertSame(
			array(
				'path'     => '/',
				'domain'   => '',
				'secure'   => true,
				'httponly' => true,
				'samesite' => 'Lax',
			),
			array_diff_key( $calls[0]['options'], array( 'expires' => true ) )
		);

		$this->assertSame( self::signed( '42.' . $calls[0]['options']['expires'] ), $calls[0]['value'] );
		$this->assertSame( $calls[0]['value'], $_COOKIE['fair_audience_session'] );
		$this->assertSame( 42, AudienceSession::get_participant_id() );
	}

	/**
	 * Invalid IDs never send a cookie.
	 *
	 * @return void
	 */
	public function test_set_ignores_invalid_id() {
		AudienceSession::set( 0 );

		$this->assertSame( array(), $GLOBALS['_fair_test_setcookie_calls'] );
		$this->assertArrayNotHasKey( 'fair_audience_session', $_COOKIE );
	}

	/**
	 * Once headers are sent, setting changes nothing.
	 *
	 * @return void
	 */
	public function test_set_after_headers_sent_does_nothing() {
		$GLOBALS['_fair_test_headers_sent'] = true;

		AudienceSession::set( 42 );

		$this->assertSame( array(), $GLOBALS['_fair_test_setcookie_calls'] );
		$this->assertArrayNotHasKey( 'fair_audience_session', $_COOKIE );
	}

	/**
	 * A cookie written by an existing release is still accepted.
	 *
	 * @return void
	 */
	public function test_get_accepts_existing_format_cookie() {
		$_COOKIE['fair_audience_session'] = self::signed( '9.' . ( time() + 60 ) );

		$this->assertSame( 9, AudienceSession::get_participant_id() );
	}

	/**
	 * Cookie values that must be rejected.
	 *
	 * @return array<string, array{0: mixed}>
	 */
	public static function rejected_cookies(): array {
		$future = time() + 600;
		$valid  = self::signed( '9.' . $future );

		return array(
			'empty'                       => array( '' ),
			'non-string'                  => array( array( 'x' ) ),
			'too few parts'               => array( '9.' . $future ),
			'non-numeric id'              => array( self::signed( 'a.' . $future ) ),
			'zero id'                     => array( self::signed( '0.' . $future ) ),
			'expired'                     => array( self::signed( '9.' . ( time() - 1 ) ) ),
			'tampered signature'          => array( substr( $valid, 0, -1 ) . ( '0' === substr( $valid, -1 ) ? '1' : '0' ) ),
			'tampered id'                 => array( '10' . substr( $valid, 1 ) ),
			'extended expiry'             => array( str_replace( '.' . $future . '.', '.' . ( $future + 3600 ) . '.', $valid ) ),
			'payment-shaped cookie'       => array( self::signed( '9.7.' . $future, 'fair_events_signup_payment_' ) ),
			'signed with payment context' => array( self::signed( '9.' . $future, 'fair_events_signup_payment_' ) ),
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
		$_COOKIE['fair_audience_session'] = $value;

		$this->assertNull( AudienceSession::get_participant_id() );
	}

	/**
	 * A payment session never identifies a participant.
	 *
	 * @return void
	 */
	public function test_payment_cookie_alone_is_not_a_participant_session() {
		$_COOKIE['fair_events_signup_payment'] = self::signed( '9.7.' . ( time() + 60 ), 'fair_events_signup_payment_' );

		$this->assertNull( AudienceSession::get_participant_id() );
	}

	/**
	 * Sliding a valid session re-issues it one hour from now.
	 *
	 * @return void
	 */
	public function test_slide_refreshes_valid_session() {
		$_COOKIE['fair_audience_session'] = self::signed( '9.' . ( time() + 10 ) );

		AudienceSession::slide();

		$calls = $GLOBALS['_fair_test_setcookie_calls'];
		$this->assertCount( 1, $calls );
		$this->assertEqualsWithDelta( time() + HOUR_IN_SECONDS, $calls[0]['options']['expires'], 2 );
		$this->assertSame( self::signed( '9.' . $calls[0]['options']['expires'] ), $_COOKIE['fair_audience_session'] );
	}

	/**
	 * Sliding without a valid session sends nothing.
	 *
	 * @return void
	 */
	public function test_slide_without_valid_session_does_nothing() {
		$_COOKIE['fair_audience_session'] = self::signed( '9.' . ( time() - 1 ) );

		AudienceSession::slide();

		$this->assertSame( array(), $GLOBALS['_fair_test_setcookie_calls'] );
	}

	/**
	 * Clearing ends the participant session and leaves the payment cookie alone.
	 *
	 * The cookie attributes and the headers-sent path belong to SessionCookie
	 * and are covered by its own tests.
	 *
	 * @return void
	 */
	public function test_clear_ends_only_the_participant_session() {
		$_COOKIE['fair_audience_session']      = self::signed( '9.' . ( time() + 60 ) );
		$_COOKIE['fair_events_signup_payment'] = 'keep';

		AudienceSession::clear();

		$this->assertSame( array( 'fair_audience_session' ), array_column( $GLOBALS['_fair_test_setcookie_calls'], 'name' ) );
		$this->assertNull( AudienceSession::get_participant_id() );
		$this->assertSame( 'keep', $_COOKIE['fair_events_signup_payment'] );
	}
}
