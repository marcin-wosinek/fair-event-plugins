<?php
/**
 * WeeklyEventsProvider unit tests.
 *
 * Pure-logic tests only — get_week() requires a live WordPress environment
 * (EventSourceRepository/wpdb, EventFeedProvider::get_occurrences()) and is
 * covered by the WP-CLI eval-file manual check instead (see TESTING.md),
 * same as EventFeedProviderTest's get_occurrences(). format_day_event() is
 * pure date logic (built on the new wp_date()/wp_timezone_string() bootstrap
 * stubs) and is reached here via Reflection since it's private.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\WeeklyEventsProvider;

/**
 * Tests for WeeklyEventsProvider's pure date-formatting logic.
 */
class WeeklyEventsProviderTest extends TestCase {

	/**
	 * Reset the timezone stub after each test.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );

		parent::tearDown();
	}

	/**
	 * Call the private format_day_event() method via Reflection.
	 *
	 * @param array         $occurrence Occurrence DTO.
	 * @param \DateTimeZone $tz         Site timezone.
	 * @return array Day-event shape.
	 */
	private function format_day_event( array $occurrence, \DateTimeZone $tz ) {
		$provider = new WeeklyEventsProvider();
		$method   = new \ReflectionMethod( WeeklyEventsProvider::class, 'format_day_event' );
		$method->setAccessible( true );

		return $method->invoke( $provider, $occurrence, $tz );
	}

	/**
	 * A multi-day occurrence spanning the 2026 US DST spring-forward date
	 * (March 8) resolves end_weekday to the correct day name — the day-level
	 * weekday label is unaffected by the local clock skipping an hour that day.
	 *
	 * @return void
	 */
	public function test_end_weekday_correct_across_dst_spring_forward() {
		$GLOBALS['_fair_test_timezone'] = 'America/New_York';
		$tz                             = new \DateTimeZone( 'America/New_York' );

		$occurrence = array(
			'title'         => 'Spans DST',
			'start'         => '2026-03-07 20:00:00',
			'end'           => '2026-03-09 06:00:00',
			'all_day'       => false,
			'url'           => '',
			'event_id'      => 1,
			'event_date_id' => 1,
		);

		$day_event = $this->format_day_event( $occurrence, $tz );

		$this->assertSame( '2026-03-09', $day_event['end_date'] );
		$this->assertSame( 'Monday', $day_event['end_weekday'] );
	}

	/**
	 * A single-day occurrence has no end_date/end_weekday set.
	 *
	 * @return void
	 */
	public function test_single_day_occurrence_has_no_end_weekday() {
		$GLOBALS['_fair_test_timezone'] = 'America/New_York';
		$tz                             = new \DateTimeZone( 'America/New_York' );

		$occurrence = array(
			'title'         => 'Single day',
			'start'         => '2026-03-08 09:00:00',
			'end'           => '2026-03-08 11:00:00',
			'all_day'       => false,
			'url'           => '',
			'event_id'      => 1,
			'event_date_id' => 1,
		);

		$day_event = $this->format_day_event( $occurrence, $tz );

		$this->assertNull( $day_event['end_date'] );
		$this->assertNull( $day_event['end_weekday'] );
	}

	/**
	 * Parse_iso_week() correctly parses a well-formed ISO week string
	 * identifying the week containing the 2026 DST spring-forward date.
	 *
	 * @return void
	 */
	public function test_parse_iso_week_valid() {
		$provider = new WeeklyEventsProvider();

		$this->assertSame(
			array(
				'year' => 2026,
				'week' => 10,
			),
			$provider->parse_iso_week( '2026-W10' )
		);
	}

	/**
	 * Parse_iso_week() rejects a malformed ISO week string.
	 *
	 * @return void
	 */
	public function test_parse_iso_week_invalid() {
		$provider = new WeeklyEventsProvider();

		$this->assertNull( $provider->parse_iso_week( 'not-a-week' ) );
	}
}
