<?php
/**
 * Tests for ICalParser's timezone handling on iCal import.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\ICalParser;

/**
 * Unit tests for ICalParser::fetch_and_parse(), focused on the
 * source-timezone-to-site-local conversion at import time.
 */
class ICalParserTest extends TestCase {

	/**
	 * Reset the timezone and remote-response stubs after each test.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );
		unset( $GLOBALS['_fair_test_remote_responses'] );

		parent::tearDown();
	}

	/**
	 * Feed a raw VCALENDAR string as the response for a fake URL and parse it.
	 *
	 * @param string $ics Raw VCALENDAR content.
	 * @return array Parsed events.
	 */
	private function parse( $ics ) {
		$url = 'https://example.com/feed.ics';
		$GLOBALS['_fair_test_remote_responses'][ $url ] = array(
			'response' => array( 'code' => 200 ),
			'body'     => $ics,
		);

		return ICalParser::fetch_and_parse( $url );
	}

	/**
	 * An all-day floating DATE must not shift civil date in a negative-offset
	 * site timezone (the 20260501 -> 2026-04-30 regression this ticket guards
	 * against).
	 *
	 * @return void
	 */
	public function test_all_day_event_does_not_shift_civil_date_in_negative_offset_zone() {
		$GLOBALS['_fair_test_timezone'] = 'America/New_York';

		$ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:1\r\n"
			. "DTSTART;VALUE=DATE:20260501\r\nDTEND;VALUE=DATE:20260502\r\n"
			. "SUMMARY:All day\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

		$events = $this->parse( $ics );

		$this->assertCount( 1, $events );
		$this->assertTrue( $events[0]['all_day'] );
		$this->assertSame( '2026-05-01 00:00:00', $events[0]['start'] );
		$this->assertSame( '2026-05-01 00:00:00', $events[0]['end'] );
	}

	/**
	 * A timed event with an explicit TZID differing from the site timezone
	 * converts to the correct site-local wall-clock time.
	 *
	 * @return void
	 */
	public function test_timed_event_with_explicit_tzid_converts_to_site_local() {
		$GLOBALS['_fair_test_timezone'] = 'America/New_York';

		$ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:2\r\n"
			. "DTSTART;TZID=Europe/Madrid:20260615T180000\r\nDTEND;TZID=Europe/Madrid:20260615T190000\r\n"
			. "SUMMARY:Timed TZID\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

		$events = $this->parse( $ics );

		$this->assertCount( 1, $events );
		$this->assertFalse( $events[0]['all_day'] );
		$this->assertSame( '2026-06-15 12:00:00', $events[0]['start'] );
		$this->assertSame( '2026-06-15 13:00:00', $events[0]['end'] );
	}

	/**
	 * A timed event with a UTC 'Z' suffix converts to the correct site-local
	 * wall-clock time.
	 *
	 * @return void
	 */
	public function test_timed_event_with_utc_z_converts_to_site_local() {
		$GLOBALS['_fair_test_timezone'] = 'America/New_York';

		$ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:3\r\n"
			. "DTSTART:20260615T160000Z\r\nDTEND:20260615T170000Z\r\n"
			. "SUMMARY:Timed UTC\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

		$events = $this->parse( $ics );

		$this->assertCount( 1, $events );
		$this->assertSame( '2026-06-15 12:00:00', $events[0]['start'] );
		$this->assertSame( '2026-06-15 13:00:00', $events[0]['end'] );
	}

	/**
	 * A floating timed event (no TZID, no Z) has no source timezone, so it is
	 * interpreted directly as site-local wall-clock time — no shift.
	 *
	 * @return void
	 */
	public function test_floating_timed_event_is_interpreted_as_site_local() {
		$GLOBALS['_fair_test_timezone'] = 'America/New_York';

		$ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:4\r\n"
			. "DTSTART:20260615T120000\r\nDTEND:20260615T130000\r\n"
			. "SUMMARY:Floating timed\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

		$events = $this->parse( $ics );

		$this->assertCount( 1, $events );
		$this->assertSame( '2026-06-15 12:00:00', $events[0]['start'] );
		$this->assertSame( '2026-06-15 13:00:00', $events[0]['end'] );
	}
}
