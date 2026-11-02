<?php
/**
 * Tests for the vendored FairEventsShared\Helpers\MeetupEventData (#2124).
 *
 * Lives in fair-events/__tests__/ alongside the other shared-helper tests;
 * runs against fixture HTML only (no network, independent of Meetup).
 *
 * @package FairEvents
 */

namespace FairEventsShared\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Helpers\MeetupEventData;
use FairEventsShared\Helpers\PageMetadataParser;

/**
 * Tests Meetup URL recognition and the `__NEXT_DATA__` fallback.
 */
class MeetupEventDataTest extends TestCase {

	const URL = 'https://www.meetup.com/idiolect/events/317159839/';

	/**
	 * Reset the stubbed site timezone before each test.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';
	}

	/**
	 * The captured Meetup page fixture.
	 *
	 * @return string HTML.
	 */
	private function fixture() {
		return file_get_contents( __DIR__ . '/../fixtures/meetup/event-page.html' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local test fixture.
	}

	/**
	 * The captured fixture with its schema.org Event JSON-LD removed, so the
	 * page only has Open Graph, <title>, and the embedded event.
	 *
	 * @return string HTML.
	 */
	private function fixture_without_schema_event() {
		return preg_replace(
			'#<script type="application/ld\+json"[^>]*>\{"@context":"https://schema.org","@type":"Event".*?</script>#s',
			'',
			$this->fixture()
		);
	}

	/**
	 * A minimal page whose only metadata is the given embedded event.
	 *
	 * @param array $event Embedded event object.
	 * @return string HTML.
	 */
	private function page_with_event( $event ) {
		return '<html><head><title>Fallback | Meetup</title></head><body>'
			. '<script id="__NEXT_DATA__" type="application/json">'
			. wp_json_encode( array( 'props' => array( 'pageProps' => array( 'event' => $event ) ) ) )
			. '</script></body></html>';
	}

	/**
	 * Run the parser and the Meetup fallback the way lookup_url() does.
	 *
	 * @param string $html HTML.
	 * @param string $url  Page URL.
	 * @return array Metadata.
	 */
	private function lookup( $html, $url = self::URL ) {
		return MeetupEventData::fill_missing( $url, $html, PageMetadataParser::parse( $html ) );
	}

	/**
	 * Meetup event URLs are recognized, with or without a locale prefix and
	 * on Meetup subdomains.
	 *
	 * @return void
	 */
	public function test_recognizes_meetup_event_urls() {
		$this->assertSame( '317159839', MeetupEventData::event_id_from_url( self::URL ) );
		$this->assertSame( '317159839', MeetupEventData::event_id_from_url( 'https://www.meetup.com/es-ES/idiolect/events/317159839/' ) );
		$this->assertSame( '317159839', MeetupEventData::event_id_from_url( 'https://www.meetup.com/es/idiolect/events/317159839' ) );
		$this->assertSame( '317159839', MeetupEventData::event_id_from_url( 'https://meetup.com/idiolect/events/317159839/?eventOrigin=group' ) );
	}

	/**
	 * Non-Meetup hosts and non-event Meetup pages are not recognized.
	 *
	 * @return void
	 */
	public function test_rejects_other_urls() {
		$this->assertNull( MeetupEventData::event_id_from_url( 'https://evilmeetup.com/idiolect/events/317159839/' ) );
		$this->assertNull( MeetupEventData::event_id_from_url( 'https://www.meetup.com.example.org/idiolect/events/317159839/' ) );
		$this->assertNull( MeetupEventData::event_id_from_url( 'https://www.meetup.com/idiolect/' ) );
		$this->assertNull( MeetupEventData::event_id_from_url( 'https://www.meetup.com/idiolect/events/' ) );
		$this->assertNull( MeetupEventData::event_id_from_url( 'https://www.meetup.com/idiolect/events/317159839/attendees/' ) );
		$this->assertNull( MeetupEventData::event_id_from_url( 'ftp://www.meetup.com/idiolect/events/317159839/' ) );
		$this->assertNull( MeetupEventData::event_id_from_url( null ) );
	}

	/**
	 * The captured page's JSON-LD yields the full event, which the fallback
	 * leaves as it is.
	 *
	 * @return void
	 */
	public function test_captured_page_is_parsed_from_schema() {
		$result = $this->lookup( $this->fixture() );

		$this->assertSame( 'schema', $result['source'] );
		$this->assertSame( '2/8 spots left for this semi-class: Speak Spanish, Play Catan', $result['title'] );
		$this->assertSame( '2026-11-06', $result['start_date'] );
		$this->assertSame( '19:00:00', $result['start_time'] );
		$this->assertSame( '2026-11-06', $result['end_date'] );
		$this->assertSame( '22:00:00', $result['end_time'] );
		$this->assertSame( 'New ziryab', $result['location'] );
		$this->assertSame( array( 'title', 'start', 'end', 'location' ), $result['found'] );
	}

	/**
	 * Without a schema.org Event, the embedded event fills title, times, and
	 * venue, replacing Meetup's dated Open Graph title.
	 *
	 * @return void
	 */
	public function test_fills_from_embedded_event_without_schema() {
		$result = $this->lookup( $this->fixture_without_schema_event() );

		$this->assertSame( 'meetup', $result['source'] );
		$this->assertSame( '2/8 spots left for this semi-class: Speak Spanish, Play Catan', $result['title'] );
		$this->assertSame( '2026-11-06 19:00:00', $result['start_datetime'] );
		$this->assertSame( '2026-11-06 22:00:00', $result['end_datetime'] );
		$this->assertFalse( $result['all_day'] );
		$this->assertSame( '19:00:00', $result['start_time'] );
		$this->assertSame( '22:00:00', $result['end_time'] );
		$this->assertSame( 'New ziryab', $result['location'] );
		$this->assertSame( array( 'title', 'start', 'end', 'location' ), $result['found'] );
	}

	/**
	 * Offsets convert to the site timezone, including across a date boundary.
	 *
	 * @return void
	 */
	public function test_converts_to_site_timezone_with_date_rollover() {
		$GLOBALS['_fair_test_timezone'] = 'America/New_York';

		$result = $this->lookup(
			$this->page_with_event(
				array(
					'id'       => '317159839',
					'title'    => 'Late show',
					'dateTime' => '2026-11-07T01:30:00+01:00',
					'endTime'  => '2026-11-07T03:00:00+01:00',
				)
			)
		);

		// 01:30 CET is 19:30 EST the previous day.
		$this->assertSame( '2026-11-06', $result['start_date'] );
		$this->assertSame( '19:30:00', $result['start_time'] );
		$this->assertSame( '2026-11-06', $result['end_date'] );
		$this->assertSame( '21:00:00', $result['end_time'] );
	}

	/**
	 * A timestamp without an offset is read in the event's own timezone,
	 * honouring daylight saving time.
	 *
	 * @return void
	 */
	public function test_uses_event_timezone_for_values_without_offset() {
		$GLOBALS['_fair_test_timezone'] = 'UTC';

		$result = $this->lookup(
			$this->page_with_event(
				array(
					'id'       => '317159839',
					'title'    => 'Summer and winter',
					'dateTime' => '2026-07-01T19:00:00',
					'endTime'  => '2026-07-01T21:00',
					'timezone' => 'Europe/Madrid',
				)
			)
		);

		// Madrid is UTC+2 in July (CEST).
		$this->assertSame( '2026-07-01 17:00:00', $result['start_datetime'] );
		$this->assertSame( '2026-07-01 19:00:00', $result['end_datetime'] );
	}

	/**
	 * A timestamp without an offset and without a valid event timezone is
	 * left missing rather than guessed.
	 *
	 * @return void
	 */
	public function test_leaves_time_missing_without_timezone() {
		foreach ( array( null, 'Not/AZone' ) as $timezone ) {
			$event = array(
				'id'       => '317159839',
				'title'    => 'Floating time',
				'dateTime' => '2026-07-01T19:00:00',
			);
			if ( $timezone ) {
				$event['timezone'] = $timezone;
			}

			$result = $this->lookup( $this->page_with_event( $event ) );

			$this->assertSame( 'Floating time', $result['title'] );
			$this->assertNull( $result['start_datetime'] );
			$this->assertNull( $result['start_time'] );
			$this->assertNull( $result['end_datetime'] );
			$this->assertSame( array( 'title' ), $result['found'] );
		}
	}

	/**
	 * A missing end time stays missing — no duration is estimated — and a
	 * missing venue leaves the location empty.
	 *
	 * @return void
	 */
	public function test_does_not_invent_end_or_venue() {
		$result = $this->lookup(
			$this->page_with_event(
				array(
					'id'       => '317159839',
					'title'    => 'Open-ended',
					'dateTime' => '2026-11-06T19:00:00+01:00',
				)
			)
		);

		$this->assertSame( '19:00:00', $result['start_time'] );
		$this->assertNull( $result['end_datetime'] );
		$this->assertNull( $result['end_date'] );
		$this->assertNull( $result['end_time'] );
		$this->assertNull( $result['location'] );
		$this->assertSame( array( 'title', 'start' ), $result['found'] );
	}

	/**
	 * A date-only value is kept as an all-day date.
	 *
	 * @return void
	 */
	public function test_keeps_date_only_values() {
		$result = $this->lookup(
			$this->page_with_event(
				array(
					'id'       => '317159839',
					'title'    => 'Festival',
					'dateTime' => '2026-11-06',
					'endTime'  => '2026-11-08',
				)
			)
		);

		$this->assertTrue( $result['all_day'] );
		$this->assertSame( '2026-11-06', $result['start_date'] );
		$this->assertNull( $result['start_time'] );
		$this->assertSame( '2026-11-08', $result['end_date'] );
		$this->assertNull( $result['end_time'] );
	}

	/**
	 * An end before the start, and unparsable values, are dropped.
	 *
	 * @return void
	 */
	public function test_drops_invalid_times() {
		$result = $this->lookup(
			$this->page_with_event(
				array(
					'id'       => '317159839',
					'title'    => 'Bad data',
					'dateTime' => '2026-11-06T19:00:00+01:00',
					'endTime'  => '2026-11-06T18:00:00+01:00',
				)
			)
		);
		$this->assertNull( $result['end_datetime'] );

		$result = $this->lookup(
			$this->page_with_event(
				array(
					'id'       => '317159839',
					'title'    => 'Bad data',
					'dateTime' => 'tomorrow',
				)
			)
		);
		$this->assertNull( $result['start_datetime'] );
	}

	/**
	 * Schema.org values stay authoritative; only the fields it lacks are
	 * filled from the embedded event.
	 *
	 * @return void
	 */
	public function test_fills_only_fields_missing_from_schema() {
		$html = '<html><head><script type="application/ld+json">'
			. wp_json_encode(
				array(
					'@type'    => 'Event',
					'name'     => 'Schema title',
					'location' => array( 'name' => 'Schema venue' ),
				)
			)
			. '</script></head><body><script id="__NEXT_DATA__" type="application/json">'
			. wp_json_encode(
				array(
					'props' => array(
						'pageProps' => array(
							'event' => array(
								'id'       => '317159839',
								'title'    => 'Embedded title',
								'dateTime' => '2026-11-06T19:00:00+01:00',
								'endTime'  => '2026-11-06T22:00:00+01:00',
								'venue'    => array( 'name' => 'Embedded venue' ),
							),
						),
					),
				)
			)
			. '</script></body></html>';

		$result = $this->lookup( $html );

		$this->assertSame( 'schema', $result['source'] );
		$this->assertSame( 'Schema title', $result['title'] );
		$this->assertSame( 'Schema venue', $result['location'] );
		$this->assertSame( '2026-11-06 19:00:00', $result['start_datetime'] );
		$this->assertSame( '2026-11-06 22:00:00', $result['end_datetime'] );
		$this->assertSame( array( 'title', 'start', 'end', 'location' ), $result['found'] );
	}

	/**
	 * Online events have no venue to prefill.
	 *
	 * @return void
	 */
	public function test_skips_venue_for_online_events() {
		$result = $this->lookup(
			$this->page_with_event(
				array(
					'id'        => '317159839',
					'title'     => 'Webinar',
					'eventType' => 'ONLINE',
					'venue'     => array( 'name' => 'Online event' ),
				)
			)
		);

		$this->assertNull( $result['location'] );
	}

	/**
	 * An embedded event with another ID (e.g. a recommendation), a
	 * non-Meetup URL, and malformed JSON all leave the metadata unchanged.
	 *
	 * @return void
	 */
	public function test_leaves_metadata_unchanged_when_not_applicable() {
		$mismatch = $this->page_with_event(
			array(
				'id'       => '399999999',
				'title'    => 'Other event',
				'dateTime' => '2026-12-01T10:00:00+01:00',
			)
		);
		$this->assertSame( PageMetadataParser::parse( $mismatch ), $this->lookup( $mismatch ) );

		$other_site = $this->fixture_without_schema_event();
		$this->assertSame(
			PageMetadataParser::parse( $other_site ),
			$this->lookup( $other_site, 'https://example.com/idiolect/events/317159839/' )
		);

		$malformed = '<html><head><title>Broken | Meetup</title></head><body>'
			. '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"event":</script></body></html>';
		$this->assertSame( PageMetadataParser::parse( $malformed ), $this->lookup( $malformed ) );
	}
}
