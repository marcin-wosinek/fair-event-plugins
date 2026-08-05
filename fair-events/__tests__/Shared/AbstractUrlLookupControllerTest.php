<?php
/**
 * Tests for the vendored FairEventsShared\API\AbstractUrlLookupController.
 *
 * Lives in fair-events/__tests__/ per TESTING.md — this plugin already has
 * phpunit.xml, a stub bootstrap, and `npm run test:php` wired into CI, and it
 * tests exactly the vendored copy that ships in this plugin's build. Covers
 * the shared validate_url_param()/lookup_url() body once here rather than
 * duplicating it across EventLookupController and UrlPreviewController.
 *
 * @package FairEvents
 */

namespace FairEventsShared\Tests\API;

use PHPUnit\Framework\TestCase;
use WP_Error;
use WP_REST_Response;

require_once __DIR__ . '/TestUrlLookupController.php';

/**
 * Tests validate_url_param() and lookup_url() against fixture HTML strings —
 * fully hermetic, no network (SafeUrlFetcher's wp_safe_remote_get() call is
 * backed by the bootstrap's stub, seeded per test).
 */
class AbstractUrlLookupControllerTest extends TestCase {

	/**
	 * Controller instance under test.
	 *
	 * @var TestUrlLookupController
	 */
	private $controller;

	/**
	 * Reset the stubbed remote-response registry and build a fresh controller
	 * before each test.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_remote_responses'] = array();
		$this->controller                       = new TestUrlLookupController();
	}

	/**
	 * A well-formed https URL validates.
	 *
	 * @return void
	 */
	public function test_validate_url_param_accepts_https() {
		$this->assertTrue( $this->controller->validate_url( 'https://example.com/event' ) );
	}

	/**
	 * A javascript: URL is rejected — only http/https schemes are allowed.
	 *
	 * @return void
	 */
	public function test_validate_url_param_rejects_non_http_scheme() {
		$this->assertFalse( $this->controller->validate_url( 'javascript:alert(1)' ) );
	}

	/**
	 * A non-string value is rejected.
	 *
	 * @return void
	 */
	public function test_validate_url_param_rejects_non_string() {
		$this->assertFalse( $this->controller->validate_url( array( 'https://example.com' ) ) );
	}

	/**
	 * A page with schema.org Event JSON-LD returns a 200 response carrying the
	 * parsed metadata.
	 *
	 * @return void
	 */
	public function test_lookup_url_returns_response_on_success() {
		$html = '<html><head><script type="application/ld+json">'
			. wp_json_encode(
				array(
					'@type'     => 'Event',
					'name'      => 'Community Picnic',
					'startDate' => '2026-09-12T18:00:00+00:00',
				)
			)
			. '</script></head></html>';

		$GLOBALS['_fair_test_remote_responses']['https://example.com/event'] = array(
			'response' => array( 'code' => 200 ),
			'headers'  => array( 'content-type' => 'text/html' ),
			'body'     => $html,
		);

		$result = $this->controller->do_lookup( 'https://example.com/event' );

		$this->assertInstanceOf( WP_REST_Response::class, $result );
		$this->assertSame( 200, $result->get_status() );
		$this->assertSame( 'Community Picnic', $result->get_data()['title'] );
	}

	/**
	 * A transport-level failure (from SafeUrlFetcher) passes its WP_Error
	 * straight through.
	 *
	 * @return void
	 */
	public function test_lookup_url_passes_through_fetch_error() {
		$GLOBALS['_fair_test_remote_responses']['https://unreachable.example/'] = new WP_Error(
			'http_request_failed',
			'Could not resolve host.'
		);

		$result = $this->controller->do_lookup( 'https://unreachable.example/' );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'rest_lookup_unreachable', $result->get_error_code() );
	}

	/**
	 * A page with no usable metadata (no schema, no OG title, no <title>)
	 * returns a 422 WP_Error rather than an empty success response.
	 *
	 * @return void
	 */
	public function test_lookup_url_returns_422_when_no_metadata_found() {
		$GLOBALS['_fair_test_remote_responses']['https://example.com/blank-page'] = array(
			'response' => array( 'code' => 200 ),
			'headers'  => array( 'content-type' => 'text/html' ),
			'body'     => '<html><body>Nothing useful here.</body></html>',
		);

		$result = $this->controller->do_lookup( 'https://example.com/blank-page' );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'rest_lookup_no_metadata', $result->get_error_code() );
	}
}
