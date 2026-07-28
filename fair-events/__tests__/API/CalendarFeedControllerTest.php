<?php
/**
 * CalendarFeedController round-trip tests.
 *
 * Build_vcalendar() is pure occurrence-DTO-in, VCalendar-out logic (no DB) and
 * is reached here via Reflection since it's private. Round-trips the
 * serialized ICS back through ICalParser to confirm export + re-import land
 * on the same site-local instant.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\API;

use PHPUnit\Framework\TestCase;
use FairEvents\API\CalendarFeedController;
use FairEvents\Helpers\ICalParser;

/**
 * Tests for CalendarFeedController's ICS export.
 */
class CalendarFeedControllerTest extends TestCase {

	/**
	 * Reset stubs after each test.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );
		unset( $GLOBALS['_fair_test_remote_responses'] );

		parent::tearDown();
	}

	/**
	 * Build a VCALENDAR from occurrence DTOs via the private build_vcalendar().
	 *
	 * @param array[] $occurrences Occurrence DTOs.
	 * @return string Serialized ICS.
	 */
	private function build_ics( array $occurrences ) {
		$controller = new CalendarFeedController();
		$method     = new \ReflectionMethod( CalendarFeedController::class, 'build_vcalendar' );
		$method->setAccessible( true );

		return $method->invoke( $controller, $occurrences )->serialize();
	}

	/**
	 * Re-parse a serialized ICS string via ICalParser.
	 *
	 * @param string $ics Serialized ICS.
	 * @return array Parsed events.
	 */
	private function reparse( $ics ) {
		$url = 'https://example.com/round-trip.ics';
		$GLOBALS['_fair_test_remote_responses'][ $url ] = array(
			'response' => array( 'code' => 200 ),
			'body'     => $ics,
		);

		return ICalParser::fetch_and_parse( $url );
	}

	/**
	 * A timed event on a named-timezone site round-trips through export and
	 * re-import to the same site-local instant.
	 *
	 * @return void
	 */
	public function test_timed_event_round_trips_on_named_timezone() {
		$GLOBALS['_fair_test_timezone'] = 'America/New_York';

		$occurrence = array(
			'uid'         => 'timed-1@example.com',
			'title'       => 'Timed event',
			'description' => '',
			'start'       => '2026-06-15 12:00:00',
			'end'         => '2026-06-15 13:00:00',
			'all_day'     => false,
			'url'         => '',
			'location'    => null,
		);

		$ics    = $this->build_ics( array( $occurrence ) );
		$events = $this->reparse( $ics );

		$this->assertCount( 1, $events );
		$this->assertFalse( $events[0]['all_day'] );
		$this->assertSame( '2026-06-15 12:00:00', $events[0]['start'] );
		$this->assertSame( '2026-06-15 13:00:00', $events[0]['end'] );
	}

	/**
	 * An all-day event round-trips through export and re-import to the same
	 * site-local civil date, with the exclusive iCal end date correctly
	 * resolved back to the inclusive stored end.
	 *
	 * @return void
	 */
	public function test_all_day_event_round_trips() {
		$GLOBALS['_fair_test_timezone'] = 'America/New_York';

		$occurrence = array(
			'uid'         => 'allday-1@example.com',
			'title'       => 'All day event',
			'description' => '',
			'start'       => '2026-05-01 00:00:00',
			'end'         => '2026-05-02 00:00:00',
			'all_day'     => true,
			'url'         => '',
			'location'    => null,
		);

		$ics    = $this->build_ics( array( $occurrence ) );
		$events = $this->reparse( $ics );

		$this->assertCount( 1, $events );
		$this->assertTrue( $events[0]['all_day'] );
		$this->assertSame( '2026-05-01 00:00:00', $events[0]['start'] );
		$this->assertSame( '2026-05-02 00:00:00', $events[0]['end'] );
	}

	/**
	 * A timed event round-trips through export and re-import to the same
	 * site-local instant even on a fixed-offset site timezone (no named
	 * VTIMEZONE emitted, DTSTART/DTEND use UTC 'Z' form instead).
	 *
	 * @return void
	 */
	public function test_timed_event_round_trips_on_fixed_offset_timezone() {
		$GLOBALS['_fair_test_timezone'] = '+05:00';

		$occurrence = array(
			'uid'         => 'timed-2@example.com',
			'title'       => 'Timed event',
			'description' => '',
			'start'       => '2026-06-15 18:00:00',
			'end'         => '2026-06-15 19:00:00',
			'all_day'     => false,
			'url'         => '',
			'location'    => null,
		);

		$ics    = $this->build_ics( array( $occurrence ) );
		$events = $this->reparse( $ics );

		$this->assertCount( 1, $events );
		$this->assertSame( '2026-06-15 18:00:00', $events[0]['start'] );
		$this->assertSame( '2026-06-15 19:00:00', $events[0]['end'] );
	}
}
