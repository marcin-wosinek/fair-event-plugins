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

	/**
	 * A Momoyoga event page, whose HTML has no dates, returns the start, end
	 * and venue from the event's public data.
	 *
	 * @return void
	 */
	public function test_lookup_url_fills_momoyoga_event_details() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';
		$fixtures                       = dirname( __DIR__ ) . '/fixtures/momoyoga/';
		$page_url                       = 'https://www.momoyoga.com/a-tempo-barcelona/event/6b1b2f01-877e-4718-b5f2-f15d8c58dc11';

		$GLOBALS['_fair_test_remote_responses'][ $page_url ] = array(
			'response' => array( 'code' => 200 ),
			'headers'  => array( 'content-type' => 'text/html; charset=UTF-8' ),
			'body'     => file_get_contents( $fixtures . 'page.html' ), // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local test fixture.
		);
		$GLOBALS['_fair_test_remote_responses']['https://api.momoyoga.com/clients/a-tempo-barcelona/events/6b1b2f01-877e-4718-b5f2-f15d8c58dc11'] = array(
			'response' => array( 'code' => 200 ),
			'headers'  => array( 'content-type' => 'application/ld+json; charset=utf-8' ),
			'body'     => file_get_contents( $fixtures . 'event.json' ), // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local test fixture.
		);

		$result = $this->controller->do_lookup( $page_url );

		$this->assertInstanceOf( WP_REST_Response::class, $result );
		$data = $result->get_data();
		$this->assertSame( '2026-11-07', $data['start_date'] );
		$this->assertSame( '11:30:00', $data['start_time'] );
		$this->assertSame( '14:00:00', $data['end_time'] );
		$this->assertSame( 'Atempo Barcelona', $data['location'] );
		$this->assertSame( array( 'title', 'start', 'end', 'location' ), $data['found'] );
	}

	/**
	 * When Momoyoga's event data is unavailable, the page's own title is
	 * still returned with the dates left for manual completion.
	 *
	 * @return void
	 */
	public function test_lookup_url_keeps_page_metadata_when_momoyoga_data_fails() {
		$page_url = 'https://www.momoyoga.com/a-tempo-barcelona/event/6b1b2f01-877e-4718-b5f2-f15d8c58dc11';

		$GLOBALS['_fair_test_remote_responses'][ $page_url ] = array(
			'response' => array( 'code' => 200 ),
			'headers'  => array( 'content-type' => 'text/html' ),
			'body'     => file_get_contents( dirname( __DIR__ ) . '/fixtures/momoyoga/page.html' ), // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local test fixture.
		);
		$GLOBALS['_fair_test_remote_responses']['https://api.momoyoga.com/clients/a-tempo-barcelona/events/6b1b2f01-877e-4718-b5f2-f15d8c58dc11'] = new WP_Error( 'http_request_failed', 'timeout' );

		$result = $this->controller->do_lookup( $page_url );

		$this->assertInstanceOf( WP_REST_Response::class, $result );
		$data = $result->get_data();
		$this->assertSame( 'Taller de Acroyoga Fundamentos ✦ noviembre', $data['title'] );
		$this->assertNull( $data['start_date'] );
		$this->assertSame( array( 'title' ), $data['found'] );
	}

	/**
	 * A Meetup event page whose JSON-LD lacks the Event is filled from its
	 * embedded event data through lookup_url() (#2124).
	 *
	 * @return void
	 */
	public function test_lookup_url_fills_meetup_event_from_embedded_data() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		$url  = 'https://www.meetup.com/es-ES/idiolect/events/317159839/';
		$html = preg_replace(
			'#<script type="application/ld\+json"[^>]*>\{"@context":"https://schema.org","@type":"Event".*?</script>#s',
			'',
			file_get_contents( __DIR__ . '/../fixtures/meetup/event-page.html' ) // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local test fixture.
		);

		$GLOBALS['_fair_test_remote_responses'][ $url ] = array(
			'response' => array( 'code' => 200 ),
			'headers'  => array( 'content-type' => 'text/html; charset=utf-8' ),
			'body'     => $html,
		);

		$data = $this->controller->do_lookup( $url )->get_data();

		$this->assertSame( 'meetup', $data['source'] );
		$this->assertSame( '2/8 spots left for this semi-class: Speak Spanish, Play Catan', $data['title'] );
		$this->assertSame( '2026-11-06', $data['start_date'] );
		$this->assertSame( '19:00:00', $data['start_time'] );
		$this->assertSame( '22:00:00', $data['end_time'] );
		$this->assertSame( 'New ziryab', $data['location'] );
	}

	/**
	 * The same embedded data on a non-Meetup URL is ignored, so generic
	 * imports keep their Open Graph result.
	 *
	 * @return void
	 */
	public function test_lookup_url_ignores_embedded_event_on_other_sites() {
		$url  = 'https://example.com/idiolect/events/317159839/';
		$html = '<html><head><meta property="og:title" content="OG Title"></head><body>'
			. '<script id="__NEXT_DATA__" type="application/json">'
			. wp_json_encode(
				array(
					'props' => array(
						'pageProps' => array(
							'event' => array(
								'id'       => '317159839',
								'title'    => 'Embedded',
								'dateTime' => '2026-11-06T19:00:00+01:00',
							),
						),
					),
				)
			)
			. '</script></body></html>';

		$GLOBALS['_fair_test_remote_responses'][ $url ] = array(
			'response' => array( 'code' => 200 ),
			'headers'  => array( 'content-type' => 'text/html' ),
			'body'     => $html,
		);

		$data = $this->controller->do_lookup( $url )->get_data();

		$this->assertSame( 'opengraph', $data['source'] );
		$this->assertSame( 'OG Title', $data['title'] );
		$this->assertNull( $data['start_datetime'] );
	}

	/**
	 * Meetup refusing the request (e.g. 403 to automated access) surfaces the
	 * usual fetch error, leaving manual entry open.
	 *
	 * @return void
	 */
	public function test_lookup_url_reports_blocked_meetup_page() {
		$url = 'https://www.meetup.com/idiolect/events/317159839/';

		$GLOBALS['_fair_test_remote_responses'][ $url ] = array(
			'response' => array( 'code' => 403 ),
			'headers'  => array( 'content-type' => 'text/html' ),
			'body'     => '<html><title>Access denied</title></html>',
		);

		$result = $this->controller->do_lookup( $url );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'rest_lookup_bad_status', $result->get_error_code() );
	}
}
