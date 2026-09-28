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

	/**
	 * Call the private build_location_line() with a neutral location shape.
	 *
	 * @param array|null $location Neutral location shape.
	 * @return string LOCATION text.
	 */
	private function build_location_line( $location ) {
		$controller = new CalendarFeedController();
		$method     = new \ReflectionMethod( CalendarFeedController::class, 'build_location_line' );
		$method->setAccessible( true );

		return $method->invoke( $controller, $location );
	}

	/**
	 * In-person shows the physical name/address text.
	 *
	 * @return void
	 */
	public function test_location_line_in_person() {
		$line = $this->build_location_line(
			array(
				'mode'    => 'in_person',
				'name'    => 'Venue Name',
				'address' => '123 Main St',
			)
		);

		$this->assertSame( 'Venue Name, 123 Main St', $line );
	}

	/**
	 * Online uses the joining URL as the whole LOCATION line.
	 *
	 * @return void
	 */
	public function test_location_line_online() {
		$line = $this->build_location_line(
			array(
				'mode'        => 'online',
				'joining_url' => 'https://example.com/meet',
			)
		);

		$this->assertSame( 'https://example.com/meet', $line );
	}

	/**
	 * Hybrid appends the joining URL to the physical location text.
	 *
	 * @return void
	 */
	public function test_location_line_hybrid_appends_joining_url() {
		$line = $this->build_location_line(
			array(
				'mode'        => 'hybrid',
				'name'        => 'Venue Name',
				'joining_url' => 'https://example.com/meet',
			)
		);

		$this->assertSame( 'Venue Name — https://example.com/meet', $line );
	}

	/**
	 * Hybrid with no physical fields shows only the joining URL, no leading
	 * separator.
	 *
	 * @return void
	 */
	public function test_location_line_hybrid_with_no_physical() {
		$line = $this->build_location_line(
			array(
				'mode'        => 'hybrid',
				'joining_url' => 'https://example.com/meet',
			)
		);

		$this->assertSame( 'https://example.com/meet', $line );
	}

	/**
	 * Call the private build_description().
	 *
	 * @param string $description Occurrence description.
	 * @param string $url         Resolved event URL.
	 * @return string DESCRIPTION text.
	 */
	private function build_description( $description, $url ) {
		$controller = new CalendarFeedController();
		$method     = new \ReflectionMethod( CalendarFeedController::class, 'build_description' );
		$method->setAccessible( true );

		return $method->invoke( $controller, $description, $url );
	}

	/**
	 * The URL goes on its own final line, after a blank line.
	 *
	 * @return void
	 */
	public function test_description_appends_url_on_separate_line() {
		$this->assertSame(
			"Line one\nLine two\n\nhttps://example.com/event",
			$this->build_description( "Line one\nLine two", 'https://example.com/event' )
		);
	}

	/**
	 * An empty description becomes just the URL.
	 *
	 * @return void
	 */
	public function test_description_empty_is_url_only() {
		$this->assertSame( 'https://example.com/event', $this->build_description( '', 'https://example.com/event' ) );
	}

	/**
	 * A description already ending in the URL line is left unchanged.
	 *
	 * @return void
	 */
	public function test_description_does_not_duplicate_url() {
		$description = "About the event\n\nhttps://example.com/event";

		$this->assertSame( $description, $this->build_description( $description, 'https://example.com/event' ) );
		$this->assertSame( $description, $this->build_description( $description . "\n", 'https://example.com/event' ) );
	}

	/**
	 * The URL mentioned mid-text doesn't count as the final link line.
	 *
	 * @return void
	 */
	public function test_description_url_in_text_still_appends() {
		$this->assertSame(
			"See https://example.com/event for more.\n\nhttps://example.com/event",
			$this->build_description( 'See https://example.com/event for more.', 'https://example.com/event' )
		);
	}

	/**
	 * Without a URL the description is unchanged.
	 *
	 * @return void
	 */
	public function test_description_without_url_is_unchanged() {
		$this->assertSame( 'About the event', $this->build_description( 'About the event', '' ) );
	}

	/**
	 * The serialized VEVENT carries the link in both URL and DESCRIPTION, and
	 * a local event without a URL falls back to the event-date view.
	 *
	 * @return void
	 */
	public function test_vevent_links_in_url_and_description() {
		$base = array(
			'title'    => 'Event',
			'start'    => '2026-06-15 12:00:00',
			'end'      => '2026-06-15 13:00:00',
			'all_day'  => false,
			'location' => null,
		);

		$ics = $this->build_ics(
			array(
				array_merge(
					$base,
					array(
						'uid'           => 'linked@example.com',
						'event_date_id' => 7,
						'description'   => 'Bring shoes, please',
						'url'           => 'https://example.com/a-rather-long-event-page-url-that-forces-line-folding',
					)
				),
				array_merge(
					$base,
					array(
						'uid'           => 'unlinked@example.com',
						'event_date_id' => 8,
						'description'   => '',
						'url'           => null,
					)
				),
			)
		);

		$vcalendar = \Sabre\VObject\Reader::read( $ics );
		$events    = array();
		foreach ( $vcalendar->select( 'VEVENT' ) as $vevent ) {
			$events[ (string) $vevent->{'UID'} ] = $vevent;
		}

		$linked = $events['linked@example.com'];
		$this->assertSame( 'https://example.com/a-rather-long-event-page-url-that-forces-line-folding', (string) $linked->{'URL'} );
		$this->assertSame( "Bring shoes, please\n\nhttps://example.com/a-rather-long-event-page-url-that-forces-line-folding", (string) $linked->{'DESCRIPTION'} );

		$unlinked = $events['unlinked@example.com'];
		$this->assertSame( 'https://example.com/?fair_event_date=8', (string) $unlinked->{'URL'} );
		$this->assertSame( 'https://example.com/?fair_event_date=8', (string) $unlinked->{'DESCRIPTION'} );
	}
}
