<?php
/**
 * Tests for the vendored FairEventsShared\Helpers\SafeUrlFetcher.
 *
 * Lives in fair-events/__tests__/ per TESTING.md — this plugin already has
 * phpunit.xml, a stub bootstrap, and `npm run test:php` wired into CI, and it
 * tests exactly the vendored copy that ships in this plugin's build.
 *
 * @package FairEvents
 */

namespace FairEventsShared\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Helpers\SafeUrlFetcher;
use WP_Error;

/**
 * Tests the fetch/validation rules against the bootstrap's wp_remote_get()
 * stub, seeded per test via $GLOBALS['_fair_test_remote_responses'].
 */
class SafeUrlFetcherTest extends TestCase {

	/**
	 * Reset the stubbed remote-response registry before each test.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_remote_responses'] = array();
	}

	/**
	 * A successful HTML response returns the raw body.
	 *
	 * @return void
	 */
	public function test_returns_body_on_success() {
		$GLOBALS['_fair_test_remote_responses']['https://example.com/event'] = array(
			'response' => array( 'code' => 200 ),
			'headers'  => array( 'content-type' => 'text/html; charset=utf-8' ),
			'body'     => '<html>ok</html>',
		);

		$result = SafeUrlFetcher::fetch( 'https://example.com/event' );

		$this->assertSame( '<html>ok</html>', $result );
	}

	/**
	 * A transport-level failure (e.g. unreachable host, private-IP rejection
	 * by the real wp_safe_remote_get()) returns a WP_Error, never throws.
	 *
	 * @return void
	 */
	public function test_transport_error_returns_wp_error() {
		$GLOBALS['_fair_test_remote_responses']['https://unreachable.example/'] = new WP_Error(
			'http_request_failed',
			'Could not resolve host.'
		);

		$result = SafeUrlFetcher::fetch( 'https://unreachable.example/' );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'rest_lookup_unreachable', $result->get_error_code() );
	}

	/**
	 * A non-2xx status is rejected.
	 *
	 * @return void
	 */
	public function test_non_2xx_status_returns_wp_error() {
		$GLOBALS['_fair_test_remote_responses']['https://example.com/missing'] = array(
			'response' => array( 'code' => 404 ),
			'body'     => 'Not found',
		);

		$result = SafeUrlFetcher::fetch( 'https://example.com/missing' );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'rest_lookup_bad_status', $result->get_error_code() );
	}

	/**
	 * A non-HTML content type is rejected.
	 *
	 * @return void
	 */
	public function test_non_html_content_type_returns_wp_error() {
		$GLOBALS['_fair_test_remote_responses']['https://example.com/data.json'] = array(
			'response' => array( 'code' => 200 ),
			'headers'  => array( 'content-type' => 'application/json' ),
			'body'     => '{"a":1}',
		);

		$result = SafeUrlFetcher::fetch( 'https://example.com/data.json' );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'rest_lookup_not_html', $result->get_error_code() );
	}

	/**
	 * An empty body is rejected.
	 *
	 * @return void
	 */
	public function test_empty_body_returns_wp_error() {
		$GLOBALS['_fair_test_remote_responses']['https://example.com/blank'] = array(
			'response' => array( 'code' => 200 ),
			'headers'  => array( 'content-type' => 'text/html' ),
			'body'     => '',
		);

		$result = SafeUrlFetcher::fetch( 'https://example.com/blank' );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'rest_lookup_empty', $result->get_error_code() );
	}
}
