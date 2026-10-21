<?php
/**
 * PublicEndpointRateLimiter tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Services;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Services\PublicEndpointRateLimiter;

/**
 * Unit tests for the fixed-window, per-IP counters of the public payment,
 * nonce and webhook routes.
 */
class PublicEndpointRateLimiterTest extends TestCase {

	/**
	 * Current fake time.
	 *
	 * @var int
	 */
	private $now = 1700000000;

	/**
	 * REMOTE_ADDR before the test.
	 *
	 * @var mixed
	 */
	private $previous_remote_addr;

	/**
	 * Empty transients and a known client address.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->previous_remote_addr       = $_SERVER['REMOTE_ADDR'] ?? null; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- saved verbatim and restored in tearDown().
		$_SERVER['REMOTE_ADDR']           = '203.0.113.7';
		$GLOBALS['_fair_test_transients'] = array();
		unset( $GLOBALS['_fair_test_transient_ttls'] );
	}

	/**
	 * Restore globals.
	 */
	protected function tearDown(): void {
		if ( null === $this->previous_remote_addr ) {
			unset( $_SERVER['REMOTE_ADDR'] );
		} else {
			$_SERVER['REMOTE_ADDR'] = $this->previous_remote_addr;
		}
		$GLOBALS['_fair_test_transients'] = array();
		unset( $GLOBALS['_fair_test_transient_ttls'], $_SERVER['HTTP_X_FORWARDED_FOR'] );
		parent::tearDown();
	}

	/**
	 * A limiter on the fake clock.
	 *
	 * @return PublicEndpointRateLimiter
	 */
	private function limiter() {
		return new PublicEndpointRateLimiter(
			function () {
				return $this->now;
			}
		);
	}

	/**
	 * Use up a bucket's allowance.
	 *
	 * @param PublicEndpointRateLimiter $limiter Limiter.
	 * @param string                    $bucket  Bucket.
	 */
	private function exhaust( PublicEndpointRateLimiter $limiter, $bucket ) {
		$max = PublicEndpointRateLimiter::LIMITS[ $bucket ]['max'];
		for ( $i = 0; $i < $max; $i++ ) {
			$this->assertNull( $limiter->attempt( $bucket ), "Attempt {$i} of {$max} should pass." );
		}
	}

	/**
	 * Each bucket and its documented allowance per minute.
	 *
	 * @return array
	 */
	public static function buckets() {
		return array(
			'payment'         => array( PublicEndpointRateLimiter::BUCKET_PAYMENT, 10 ),
			'nonce'           => array( PublicEndpointRateLimiter::BUCKET_NONCE, 60 ),
			'invalid webhook' => array( PublicEndpointRateLimiter::BUCKET_INVALID_WEBHOOK, 30 ),
		);
	}

	/**
	 * Requests up to the limit pass; the next one gets a 429.
	 *
	 * @param string $bucket Bucket.
	 * @param int    $max    Expected allowance.
	 */
	#[DataProvider( 'buckets' )]
	public function test_rejects_the_request_after_the_limit( $bucket, $max ) {
		$this->assertSame( $max, PublicEndpointRateLimiter::LIMITS[ $bucket ]['max'] );
		$this->assertSame( 60, PublicEndpointRateLimiter::LIMITS[ $bucket ]['window'] );

		$limiter = $this->limiter();
		$this->exhaust( $limiter, $bucket );

		$error = $limiter->attempt( $bucket );

		$this->assertInstanceOf( \WP_Error::class, $error );
		$this->assertSame( 'rate_limited', $error->get_error_code() );
		$this->assertSame( 429, $error->get_error_data()['status'] );
		$this->assertSame( 60, $error->get_error_data()['retry_after'] );
		$this->assertSame( 'Too many requests. Please try again in 60 seconds.', $error->get_error_message() );
	}

	/**
	 * A rejected request is not counted and does not extend the window.
	 */
	public function test_rejected_requests_do_not_extend_the_window() {
		$limiter = $this->limiter();
		$this->exhaust( $limiter, PublicEndpointRateLimiter::BUCKET_PAYMENT );

		$this->now += 30;
		$error      = $limiter->attempt( PublicEndpointRateLimiter::BUCKET_PAYMENT );
		$this->assertSame( 30, $error->get_error_data()['retry_after'] );

		$this->now += 29;
		$error      = $limiter->attempt( PublicEndpointRateLimiter::BUCKET_PAYMENT );
		$this->assertSame( 1, $error->get_error_data()['retry_after'] );
		$this->assertSame( 'Too many requests. Please try again in 1 second.', $error->get_error_message() );

		$this->now += 1;
		$this->assertNull( $limiter->attempt( PublicEndpointRateLimiter::BUCKET_PAYMENT ) );
	}

	/**
	 * Counted requests keep the window's original expiry, and the transient
	 * lives only as long as what is left of the window.
	 */
	public function test_counted_requests_keep_the_fixed_expiry() {
		$limiter = $this->limiter();
		$key     = PublicEndpointRateLimiter::key( PublicEndpointRateLimiter::BUCKET_PAYMENT, '203.0.113.7' );

		$limiter->attempt( PublicEndpointRateLimiter::BUCKET_PAYMENT );
		$this->assertSame( 60, $GLOBALS['_fair_test_transient_ttls'][ $key ] );

		$this->now += 45;
		$limiter->attempt( PublicEndpointRateLimiter::BUCKET_PAYMENT );

		$this->assertSame(
			array(
				'count'   => 2,
				'expires' => 1700000060,
			),
			$GLOBALS['_fair_test_transients'][ $key ]
		);
		$this->assertSame( 15, $GLOBALS['_fair_test_transient_ttls'][ $key ] );
	}

	/**
	 * After the window ends, a new one starts with a full allowance even if
	 * the stale transient is still around.
	 */
	public function test_an_expired_window_starts_over() {
		$limiter = $this->limiter();
		$this->exhaust( $limiter, PublicEndpointRateLimiter::BUCKET_PAYMENT );

		$this->now += 60;
		$this->exhaust( $limiter, PublicEndpointRateLimiter::BUCKET_PAYMENT );
		$this->assertInstanceOf( \WP_Error::class, $limiter->attempt( PublicEndpointRateLimiter::BUCKET_PAYMENT ) );

		$key = PublicEndpointRateLimiter::key( PublicEndpointRateLimiter::BUCKET_PAYMENT, '203.0.113.7' );
		$this->assertSame( 1700000120, $GLOBALS['_fair_test_transients'][ $key ]['expires'] );
	}

	/**
	 * Buckets have independent budgets.
	 */
	public function test_buckets_are_independent() {
		$limiter = $this->limiter();
		$this->exhaust( $limiter, PublicEndpointRateLimiter::BUCKET_NONCE );

		$this->assertInstanceOf( \WP_Error::class, $limiter->attempt( PublicEndpointRateLimiter::BUCKET_NONCE ) );
		$this->assertNull( $limiter->attempt( PublicEndpointRateLimiter::BUCKET_PAYMENT ) );
		$this->assertNull( $limiter->check( PublicEndpointRateLimiter::BUCKET_INVALID_WEBHOOK ) );
	}

	/**
	 * Clients have independent budgets, and a forwarded header is no way out.
	 */
	public function test_clients_are_independent_and_forwarded_headers_are_ignored() {
		$limiter = $this->limiter();
		$this->exhaust( $limiter, PublicEndpointRateLimiter::BUCKET_PAYMENT );

		$_SERVER['HTTP_X_FORWARDED_FOR'] = '198.51.100.1';
		$this->assertInstanceOf( \WP_Error::class, $limiter->attempt( PublicEndpointRateLimiter::BUCKET_PAYMENT ) );

		$_SERVER['REMOTE_ADDR'] = '198.51.100.1';
		$this->assertNull( $limiter->attempt( PublicEndpointRateLimiter::BUCKET_PAYMENT ) );
	}

	/**
	 * Check() reports without counting; record() counts without checking.
	 */
	public function test_check_does_not_count() {
		$limiter = $this->limiter();

		for ( $i = 0; $i < 100; $i++ ) {
			$this->assertNull( $limiter->check( PublicEndpointRateLimiter::BUCKET_INVALID_WEBHOOK ) );
		}
		$this->assertSame( array(), $GLOBALS['_fair_test_transients'] );

		for ( $i = 0; $i < 30; $i++ ) {
			$limiter->record( PublicEndpointRateLimiter::BUCKET_INVALID_WEBHOOK );
		}
		$this->assertInstanceOf( \WP_Error::class, $limiter->check( PublicEndpointRateLimiter::BUCKET_INVALID_WEBHOOK ) );
	}

	/**
	 * REMOTE_ADDR values and the client identifier they map to.
	 *
	 * @return array
	 */
	public static function addresses() {
		return array(
			'IPv4'                 => array( '203.0.113.7', '203.0.113.7' ),
			'IPv4 with whitespace' => array( ' 203.0.113.7 ', '203.0.113.7' ),
			'IPv6 upper case'      => array( '2001:DB8::1', '2001:db8::1' ),
			'IPv6 expanded'        => array( '2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1' ),
			'not an address'       => array( 'not-an-ip', PublicEndpointRateLimiter::UNKNOWN_CLIENT ),
			'address list'         => array( '203.0.113.7, 198.51.100.1', PublicEndpointRateLimiter::UNKNOWN_CLIENT ),
			'empty'                => array( '', PublicEndpointRateLimiter::UNKNOWN_CLIENT ),
			'not a string'         => array( array( '203.0.113.7' ), PublicEndpointRateLimiter::UNKNOWN_CLIENT ),
		);
	}

	/**
	 * Addresses are validated and normalized; anything else shares one bucket.
	 *
	 * @param mixed  $remote_addr REMOTE_ADDR value.
	 * @param string $expected    Expected client identifier.
	 */
	#[DataProvider( 'addresses' )]
	public function test_normalizes_the_client_address( $remote_addr, $expected ) {
		$_SERVER['REMOTE_ADDR'] = $remote_addr;

		$this->assertSame( $expected, PublicEndpointRateLimiter::client_ip() );
	}

	/**
	 * Without REMOTE_ADDR, every caller counts against the fallback bucket.
	 */
	public function test_missing_address_uses_the_fallback_bucket() {
		unset( $_SERVER['REMOTE_ADDR'] );
		$limiter = $this->limiter();
		$this->exhaust( $limiter, PublicEndpointRateLimiter::BUCKET_PAYMENT );

		$_SERVER['REMOTE_ADDR'] = 'garbage';
		$this->assertInstanceOf( \WP_Error::class, $limiter->attempt( PublicEndpointRateLimiter::BUCKET_PAYMENT ) );

		$this->assertArrayHasKey(
			PublicEndpointRateLimiter::key( PublicEndpointRateLimiter::BUCKET_PAYMENT, PublicEndpointRateLimiter::UNKNOWN_CLIENT ),
			$GLOBALS['_fair_test_transients']
		);
	}

	/**
	 * Transient keys do not contain the address.
	 */
	public function test_keys_hash_the_address() {
		$key = PublicEndpointRateLimiter::key( PublicEndpointRateLimiter::BUCKET_NONCE, '203.0.113.7' );

		$this->assertSame( 'fpc_rl_nonce_' . md5( '203.0.113.7' ), $key );
		$this->assertStringNotContainsString( '203.0.113.7', $key );
	}
}
