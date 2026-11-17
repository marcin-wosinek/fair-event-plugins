<?php
/**
 * Tests for the vendored FairEventsShared\Security\SessionCookie.
 *
 * @package FairEvents
 */

namespace FairEventsShared\Tests\Security;

// phpcs:disable WordPress.Security.ValidatedSanitizedInput -- tests inspect the raw request cookies the code under test writes.

require_once __DIR__ . '/fixtures/session-cookie-stubs.php';

use FairEventsShared\Security\SessionCookie;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

/**
 * Checks the exact cookie arguments and the request-local `$_COOKIE` updates.
 */
class SessionCookieTest extends TestCase {

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
	 * Setting sends the exact attributes over HTTP and updates the request.
	 *
	 * @return void
	 */
	public function test_set_sends_exact_cookie_over_http() {
		SessionCookie::set( 'example_session', 'abc.123', 1700000000 );

		$this->assertSame(
			array(
				array(
					'name'    => 'example_session',
					'value'   => 'abc.123',
					'options' => array(
						'expires'  => 1700000000,
						'path'     => '/',
						'domain'   => '',
						'secure'   => false,
						'httponly' => true,
						'samesite' => 'Lax',
					),
				),
			),
			$GLOBALS['_fair_test_setcookie_calls']
		);
		$this->assertSame( 'abc.123', $_COOKIE['example_session'] );
	}

	/**
	 * Over HTTPS the cookie is Secure.
	 *
	 * @return void
	 */
	public function test_set_is_secure_over_https() {
		$GLOBALS['_fair_test_is_ssl'] = true;

		SessionCookie::set( 'example_session', 'abc', 1700000000 );

		$this->assertTrue( $GLOBALS['_fair_test_setcookie_calls'][0]['options']['secure'] );
	}

	/**
	 * Defined COOKIEPATH and COOKIE_DOMAIN are used as-is.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_set_uses_cookie_path_and_domain_constants() {
		define( 'COOKIEPATH', '/blog/' );
		define( 'COOKIE_DOMAIN', 'example.com' );

		SessionCookie::set( 'example_session', 'abc', 1700000000 );

		$options = $GLOBALS['_fair_test_setcookie_calls'][0]['options'];
		$this->assertSame( '/blog/', $options['path'] );
		$this->assertSame( 'example.com', $options['domain'] );
	}

	/**
	 * An empty COOKIEPATH falls back to the root path.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_set_falls_back_to_root_for_empty_cookie_path() {
		define( 'COOKIEPATH', '' );

		SessionCookie::set( 'example_session', 'abc', 1700000000 );

		$this->assertSame( '/', $GLOBALS['_fair_test_setcookie_calls'][0]['options']['path'] );
	}

	/**
	 * A failed setcookie() still updates the request, as before.
	 *
	 * @return void
	 */
	public function test_set_updates_request_even_when_setcookie_fails() {
		$GLOBALS['_fair_test_setcookie_result'] = false;

		SessionCookie::set( 'example_session', 'abc', 1700000000 );

		$this->assertSame( 'abc', $_COOKIE['example_session'] );
	}

	/**
	 * Once headers are sent, setting changes nothing.
	 *
	 * @return void
	 */
	public function test_set_after_headers_sent_does_nothing() {
		$GLOBALS['_fair_test_headers_sent'] = true;
		$_COOKIE['example_session']         = 'old';

		SessionCookie::set( 'example_session', 'new', 1700000000 );

		$this->assertSame( array(), $GLOBALS['_fair_test_setcookie_calls'] );
		$this->assertSame( 'old', $_COOKIE['example_session'] );
	}

	/**
	 * Clearing sends an expired, empty cookie and removes only that entry.
	 *
	 * @return void
	 */
	public function test_clear_sends_expired_cookie_and_removes_entry() {
		$_COOKIE['example_session'] = 'abc';
		$_COOKIE['other_session']   = 'keep';

		SessionCookie::clear( 'example_session' );

		$calls = $GLOBALS['_fair_test_setcookie_calls'];
		$this->assertCount( 1, $calls );
		$this->assertSame( 'example_session', $calls[0]['name'] );
		$this->assertSame( '', $calls[0]['value'] );
		$this->assertEqualsWithDelta( time() - HOUR_IN_SECONDS, $calls[0]['options']['expires'], 2 );
		$this->assertSame( '/', $calls[0]['options']['path'] );
		$this->assertSame( '', $calls[0]['options']['domain'] );
		$this->assertTrue( $calls[0]['options']['httponly'] );
		$this->assertSame( 'Lax', $calls[0]['options']['samesite'] );
		$this->assertArrayNotHasKey( 'example_session', $_COOKIE );
		$this->assertSame( 'keep', $_COOKIE['other_session'] );
	}

	/**
	 * Once headers are sent, clearing still removes the request entry.
	 *
	 * @return void
	 */
	public function test_clear_after_headers_sent_removes_entry_only() {
		$GLOBALS['_fair_test_headers_sent'] = true;
		$_COOKIE['example_session']         = 'abc';

		SessionCookie::clear( 'example_session' );

		$this->assertSame( array(), $GLOBALS['_fair_test_setcookie_calls'] );
		$this->assertArrayNotHasKey( 'example_session', $_COOKIE );
	}
}
