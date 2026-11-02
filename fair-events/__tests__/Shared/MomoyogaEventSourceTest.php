<?php
/**
 * Tests for the vendored FairEventsShared\Helpers\MomoyogaEventSource.
 *
 * Lives in fair-events/__tests__/ per TESTING.md, next to the other shared
 * URL-lookup tests, and tests the vendored copy that ships in this plugin.
 *
 * @package FairEvents
 */

namespace FairEventsShared\Tests\Helpers;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use FairEventsShared\Helpers\MomoyogaEventSource;
use FairEventsShared\Helpers\PageMetadataParser;
use WP_Error;

/**
 * Tests Momoyoga URL recognition, event-data fetching and validation,
 * timestamp handling and the merge into page metadata — hermetic, against
 * sanitized fixtures captured from a real Momoyoga event (no network).
 */
class MomoyogaEventSourceTest extends TestCase {

	const PAGE_URL = 'https://www.momoyoga.com/a-tempo-barcelona/event/6b1b2f01-877e-4718-b5f2-f15d8c58dc11';
	const API_URL  = 'https://api.momoyoga.com/clients/a-tempo-barcelona/events/6b1b2f01-877e-4718-b5f2-f15d8c58dc11';
	const EVENT_ID = '6b1b2f01-877e-4718-b5f2-f15d8c58dc11';

	/**
	 * Reset the stubbed timezone and remote registries before each test.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_timezone']         = 'Europe/Madrid';
		$GLOBALS['_fair_test_remote_responses'] = array();
		$GLOBALS['_fair_test_remote_requests']  = array();
	}

	/**
	 * Read a fixture file.
	 *
	 * @param string $name File name under fixtures/momoyoga.
	 * @return string
	 */
	private function fixture( $name ) {
		return file_get_contents( dirname( __DIR__ ) . '/fixtures/momoyoga/' . $name ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local test fixture.
	}

	/**
	 * The captured event data, decoded.
	 *
	 * @return array
	 */
	private function event_data() {
		return json_decode( $this->fixture( 'event.json' ), true );
	}

	/**
	 * Seed the stubbed event-data endpoint.
	 *
	 * @param string $body         Response body.
	 * @param int    $code         HTTP status.
	 * @param string $content_type Content-Type header.
	 * @return void
	 */
	private function seed_api( $body, $code = 200, $content_type = 'application/ld+json; charset=utf-8' ) {
		$GLOBALS['_fair_test_remote_responses'][ self::API_URL ] = array(
			'response' => array( 'code' => $code ),
			'headers'  => array( 'content-type' => $content_type ),
			'body'     => $body,
		);
	}

	/**
	 * The page's own metadata, parsed from the captured HTML.
	 *
	 * @return array
	 */
	private function page_metadata() {
		return PageMetadataParser::parse( $this->fixture( 'page.html' ) );
	}

	/**
	 * Event page URLs on the Momoyoga hosts are recognized, case-insensitively,
	 * with or without a trailing slash, query string or fragment.
	 *
	 * @param string $url Event page URL.
	 * @return void
	 */
	#[DataProvider( 'provide_event_urls' )]
	public function test_match_url_recognizes_event_pages( $url ) {
		$this->assertSame(
			array(
				'profile'  => 'a-tempo-barcelona',
				'event_id' => self::EVENT_ID,
			),
			MomoyogaEventSource::match_url( $url )
		);
	}

	/**
	 * Recognized event URLs.
	 *
	 * @return array
	 */
	public static function provide_event_urls() {
		return array(
			'www host'           => array( self::PAGE_URL ),
			'bare host'          => array( 'https://momoyoga.com/a-tempo-barcelona/event/6b1b2f01-877e-4718-b5f2-f15d8c58dc11' ),
			'http'               => array( 'http://www.momoyoga.com/a-tempo-barcelona/event/6b1b2f01-877e-4718-b5f2-f15d8c58dc11' ),
			'trailing slash'     => array( self::PAGE_URL . '/' ),
			'query and fragment' => array( self::PAGE_URL . '?_locale_forcing=en#tickets' ),
			'mixed case'         => array( 'https://WWW.Momoyoga.com/A-Tempo-Barcelona/event/6B1B2F01-877E-4718-B5F2-F15D8C58DC11' ),
		);
	}

	/**
	 * Lookalike hosts, other paths and unusual URL parts are not Momoyoga
	 * event pages.
	 *
	 * @param mixed $url Candidate URL.
	 * @return void
	 */
	#[DataProvider( 'provide_non_event_urls' )]
	public function test_match_url_rejects_other_urls( $url ) {
		$this->assertNull( MomoyogaEventSource::match_url( $url ) );
	}

	/**
	 * Rejected URLs.
	 *
	 * @return array
	 */
	public static function provide_non_event_urls() {
		$path = '/a-tempo-barcelona/event/6b1b2f01-877e-4718-b5f2-f15d8c58dc11';

		return array(
			'lookalike suffix' => array( 'https://momoyoga.com.example.org' . $path ),
			'lookalike prefix' => array( 'https://evilmomoyoga.com' . $path ),
			'other subdomain'  => array( 'https://api.momoyoga.com' . $path ),
			'other host'       => array( 'https://example.com' . $path ),
			'events list'      => array( 'https://www.momoyoga.com/a-tempo-barcelona/events' ),
			'tickets subpage'  => array( 'https://www.momoyoga.com' . $path . '/tickets' ),
			'non-uuid id'      => array( 'https://www.momoyoga.com/a-tempo-barcelona/event/123' ),
			'path traversal'   => array( 'https://www.momoyoga.com/../x/event/6b1b2f01-877e-4718-b5f2-f15d8c58dc11' ),
			'credentials'      => array( 'https://user:pass@www.momoyoga.com' . $path ),
			'non-default port' => array( 'https://www.momoyoga.com:8443' . $path ),
			'non-http scheme'  => array( 'ftp://www.momoyoga.com' . $path ),
			'not a string'     => array( array( self::PAGE_URL ) ),
		);
	}

	/**
	 * The captured page alone has a title but no dates — the gap the event
	 * data fills.
	 *
	 * @return void
	 */
	public function test_captured_page_has_no_dates() {
		$metadata = $this->page_metadata();

		$this->assertSame( 'Taller de Acroyoga Fundamentos ✦ noviembre', $metadata['title'] );
		$this->assertNull( $metadata['start_date'] );
		$this->assertSame( array( 'title' ), $metadata['found'] );
	}

	/**
	 * The event data fills start, end and venue, converted to site time, and
	 * the request is bounded and asks for the JSON-LD format.
	 *
	 * @return void
	 */
	public function test_supplement_fills_dates_and_location() {
		$this->seed_api( $this->fixture( 'event.json' ) );

		$result = MomoyogaEventSource::supplement( self::PAGE_URL, $this->page_metadata() );

		$this->assertSame( 'Taller de Acroyoga Fundamentos ✦ noviembre', $result['title'] );
		$this->assertFalse( $result['all_day'] );
		$this->assertSame( '2026-11-07', $result['start_date'] );
		$this->assertSame( '11:30:00', $result['start_time'] );
		$this->assertSame( '2026-11-07 11:30:00', $result['start_datetime'] );
		$this->assertSame( '2026-11-07', $result['end_date'] );
		$this->assertSame( '14:00:00', $result['end_time'] );
		$this->assertSame( 'Atempo Barcelona', $result['location'] );
		$this->assertSame( 'opengraph', $result['source'] );
		$this->assertSame( array( 'title', 'start', 'end', 'location' ), $result['found'] );

		$this->assertCount( 1, $GLOBALS['_fair_test_remote_requests'] );
		$request = $GLOBALS['_fair_test_remote_requests'][0];
		$this->assertSame( self::API_URL, $request['url'] );
		$this->assertSame( 'application/ld+json', $request['args']['headers']['Accept'] );
		$this->assertSame( 0, $request['args']['redirection'] );
		$this->assertSame( 5, $request['args']['timeout'] );
		$this->assertSame( 512 * 1024, $request['args']['limit_response_size'] );
	}

	/**
	 * The explicit offset is honoured: the same instant reads differently in
	 * a site set to another timezone, including across the date line.
	 *
	 * @return void
	 */
	public function test_supplement_converts_to_site_timezone_with_rollover() {
		$GLOBALS['_fair_test_timezone'] = 'Asia/Tokyo';
		$data                           = $this->event_data();
		$data['fromTime']               = '2026-11-07T19:30:00+01:00';
		$data['toTime']                 = '2026-11-07T22:00:00+01:00';
		$this->seed_api( wp_json_encode( $data ) );

		$result = MomoyogaEventSource::supplement( self::PAGE_URL, $this->page_metadata() );

		$this->assertSame( '2026-11-08', $result['start_date'] );
		$this->assertSame( '03:30:00', $result['start_time'] );
		$this->assertSame( '2026-11-08', $result['end_date'] );
		$this->assertSame( '06:00:00', $result['end_time'] );
	}

	/**
	 * Summer and winter offsets both convert to the right local time.
	 *
	 * @return void
	 */
	public function test_parse_timestamp_handles_dst_offsets() {
		$summer = MomoyogaEventSource::parse_timestamp( '2026-07-04T10:00:00+02:00' );
		$winter = MomoyogaEventSource::parse_timestamp( '2026-11-07T10:00:00+01:00' );
		$utc    = MomoyogaEventSource::parse_timestamp( '2026-07-04T08:00:00Z' );

		$this->assertSame( '10:00:00', $summer['time'] );
		$this->assertSame( '10:00:00', $winter['time'] );
		$this->assertSame( '10:00:00', $utc['time'] );
	}

	/**
	 * A date and time with no offset has no verified timezone: the date is
	 * kept, the time is left missing rather than guessed.
	 *
	 * @return void
	 */
	public function test_parse_timestamp_without_offset_keeps_date_only() {
		$this->assertSame(
			array(
				'datetime' => '2026-11-07 00:00:00',
				'all_day'  => false,
				'date'     => '2026-11-07',
				'time'     => null,
			),
			MomoyogaEventSource::parse_timestamp( '2026-11-07T11:30:00' )
		);
	}

	/**
	 * A date-only value is kept as written, as an all-day date.
	 *
	 * @return void
	 */
	public function test_parse_timestamp_date_only_is_all_day() {
		$this->assertSame(
			array(
				'datetime' => '2026-11-07 00:00:00',
				'all_day'  => true,
				'date'     => '2026-11-07',
				'time'     => null,
			),
			MomoyogaEventSource::parse_timestamp( '2026-11-07' )
		);
	}

	/**
	 * Malformed or impossible timestamps are rejected.
	 *
	 * @return void
	 */
	public function test_parse_timestamp_rejects_malformed_values() {
		$this->assertNull( MomoyogaEventSource::parse_timestamp( 'sábado, 7 nov 2026 11:30' ) );
		$this->assertNull( MomoyogaEventSource::parse_timestamp( '2026-02-30T10:00:00+01:00' ) );
		$this->assertNull( MomoyogaEventSource::parse_timestamp( '2026-02-30' ) );
		$this->assertNull( MomoyogaEventSource::parse_timestamp( '' ) );
	}

	/**
	 * A missing end is not invented.
	 *
	 * @return void
	 */
	public function test_parse_event_data_without_end_leaves_end_missing() {
		$data = $this->event_data();
		unset( $data['toTime'] );

		$event = MomoyogaEventSource::parse_event_data( $data, self::EVENT_ID );

		$this->assertSame( '2026-11-07', $event['start_date'] );
		$this->assertArrayNotHasKey( 'end_date', $event );
	}

	/**
	 * An end before the start is dropped rather than kept as nonsense.
	 *
	 * @return void
	 */
	public function test_parse_event_data_drops_end_before_start() {
		$data           = $this->event_data();
		$data['toTime'] = '2026-11-07T09:00:00+01:00';

		$event = MomoyogaEventSource::parse_event_data( $data, self::EVENT_ID );

		$this->assertArrayNotHasKey( 'end_date', $event );
	}

	/**
	 * Data for a different event, or a non-Event payload, is ignored.
	 *
	 * @return void
	 */
	public function test_parse_event_data_requires_matching_event() {
		$data = $this->event_data();

		$other       = $data;
		$other['id'] = '00000000-0000-4000-8000-000000000000';
		$this->assertNull( MomoyogaEventSource::parse_event_data( $other, self::EVENT_ID ) );

		$no_id = $data;
		unset( $no_id['id'] );
		$this->assertNull( MomoyogaEventSource::parse_event_data( $no_id, self::EVENT_ID ) );

		$wrong_type          = $data;
		$wrong_type['@type'] = 'hydra:Error';
		$this->assertNull( MomoyogaEventSource::parse_event_data( $wrong_type, self::EVENT_ID ) );
	}

	/**
	 * Event data with no usable timing still fills the venue, and the start
	 * stays missing so the user completes it.
	 *
	 * @return void
	 */
	public function test_supplement_with_incomplete_data_leaves_start_missing() {
		$data = $this->event_data();
		unset( $data['fromTime'], $data['toTime'] );
		$this->seed_api( wp_json_encode( $data ) );

		$result = MomoyogaEventSource::supplement( self::PAGE_URL, $this->page_metadata() );

		$this->assertNull( $result['start_date'] );
		$this->assertNull( $result['start_time'] );
		$this->assertNull( $result['end_date'] );
		$this->assertSame( 'Atempo Barcelona', $result['location'] );
		$this->assertSame( array( 'title', 'location' ), $result['found'] );
	}

	/**
	 * Fetch failures leave the page's own metadata untouched.
	 *
	 * @param array|WP_Error $response Seeded endpoint response.
	 * @return void
	 */
	#[DataProvider( 'provide_failed_responses' )]
	public function test_supplement_keeps_page_metadata_when_fetch_fails( $response ) {
		$GLOBALS['_fair_test_remote_responses'][ self::API_URL ] = $response;
		$metadata = $this->page_metadata();

		$this->assertSame( $metadata, MomoyogaEventSource::supplement( self::PAGE_URL, $metadata ) );
	}

	/**
	 * Failed endpoint responses.
	 *
	 * @return array
	 */
	public static function provide_failed_responses() {
		$json = array( 'content-type' => 'application/ld+json' );

		return array(
			'transport error' => array( new WP_Error( 'http_request_failed', 'timeout' ) ),
			'not found'       => array(
				array(
					'response' => array( 'code' => 404 ),
					'headers'  => $json,
					'body'     => '{"title":"Not Found"}',
				),
			),
			'restricted'      => array(
				array(
					'response' => array( 'code' => 401 ),
					'headers'  => $json,
					'body'     => '{"title":"Unauthorized"}',
				),
			),
			'redirect'        => array(
				array(
					'response' => array( 'code' => 302 ),
					'headers'  => array( 'location' => 'https://www.momoyoga.com/login' ),
					'body'     => '',
				),
			),
			'html instead'    => array(
				array(
					'response' => array( 'code' => 200 ),
					'headers'  => array( 'content-type' => 'text/html' ),
					'body'     => '<html></html>',
				),
			),
			'malformed json'  => array(
				array(
					'response' => array( 'code' => 200 ),
					'headers'  => $json,
					'body'     => '{"id": "6b1b2f01-',
				),
			),
			'json list'       => array(
				array(
					'response' => array( 'code' => 200 ),
					'headers'  => $json,
					'body'     => '[1, 2]',
				),
			),
			'empty body'      => array(
				array(
					'response' => array( 'code' => 200 ),
					'headers'  => $json,
					'body'     => '',
				),
			),
		);
	}

	/**
	 * Values the page gave itself are authoritative: event data does not
	 * replace them, and no request is made when nothing is missing.
	 *
	 * @return void
	 */
	public function test_page_values_win_and_complete_pages_skip_fetch() {
		$metadata = array(
			'title'          => 'From JSON-LD',
			'start_datetime' => '2026-11-07 12:00:00',
			'end_datetime'   => '2026-11-07 13:00:00',
			'all_day'        => false,
			'start_date'     => '2026-11-07',
			'start_time'     => '12:00:00',
			'end_date'       => '2026-11-07',
			'end_time'       => '13:00:00',
			'location'       => 'Page venue',
			'source'         => 'schema',
			'found'          => array( 'title', 'start', 'end', 'location' ),
		);
		$this->seed_api( $this->fixture( 'event.json' ) );

		$this->assertSame( $metadata, MomoyogaEventSource::supplement( self::PAGE_URL, $metadata ) );
		$this->assertCount( 0, $GLOBALS['_fair_test_remote_requests'] );

		// A missing venue is filled, but the page's own timing is kept.
		$metadata['location'] = null;
		$result               = MomoyogaEventSource::supplement( self::PAGE_URL, $metadata );

		$this->assertSame( '12:00:00', $result['start_time'] );
		$this->assertSame( '13:00:00', $result['end_time'] );
		$this->assertSame( 'Atempo Barcelona', $result['location'] );
	}

	/**
	 * A page start without an end only takes the event's end when the
	 * event's start agrees, so an end is never paired with another start.
	 *
	 * @return void
	 */
	public function test_end_is_only_filled_for_a_matching_start() {
		$metadata = array_merge(
			$this->page_metadata(),
			array(
				'start_datetime' => '2026-11-07 11:30:00',
				'start_date'     => '2026-11-07',
				'start_time'     => '11:30:00',
			)
		);
		$this->seed_api( $this->fixture( 'event.json' ) );

		$matching = MomoyogaEventSource::supplement( self::PAGE_URL, $metadata );
		$this->assertSame( '14:00:00', $matching['end_time'] );

		$metadata['start_datetime'] = '2026-11-07 10:00:00';
		$metadata['start_time']     = '10:00:00';

		$different = MomoyogaEventSource::supplement( self::PAGE_URL, $metadata );
		$this->assertSame( '10:00:00', $different['start_time'] );
		$this->assertNull( $different['end_date'] );
	}

	/**
	 * Other URLs are never sent to Momoyoga.
	 *
	 * @return void
	 */
	public function test_other_urls_make_no_request() {
		$metadata = $this->page_metadata();

		$this->assertSame( $metadata, MomoyogaEventSource::supplement( 'https://example.com/event', $metadata ) );
		$this->assertCount( 0, $GLOBALS['_fair_test_remote_requests'] );
	}
}
