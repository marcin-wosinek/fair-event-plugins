<?php
/**
 * EventsWeekSummary unit tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\EventsWeekSummary;
use FairEvents\Services\EventsWeekSummaryFormatter;
use PHPUnit\Framework\TestCase;

/**
 * Tests week boundaries, headings and summary text shared by the Events Week
 * block and scheduled weekly notifications.
 */
class EventsWeekSummaryTest extends TestCase {

	/**
	 * Reset the site timezone.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );
	}

	/** Monday-start ISO weeks run Monday to Sunday. */
	public function test_iso_week_boundaries_with_monday_start() {
		$this->assertSame(
			array(
				'start' => '2026-08-31',
				'end'   => '2026-09-06',
			),
			EventsWeekSummary::iso_week_boundaries( 2026, 36, 1 )
		);
	}

	/** Sunday-start weeks begin the day before the ISO Monday. */
	public function test_iso_week_boundaries_with_sunday_start() {
		$this->assertSame(
			array(
				'start' => '2026-08-30',
				'end'   => '2026-09-05',
			),
			EventsWeekSummary::iso_week_boundaries( 2026, 36, 0 )
		);
	}

	/** The week containing a date respects the configured first weekday. */
	public function test_boundaries_containing_a_date() {
		// Sunday 6 September 2026.
		$this->assertSame( '2026-08-31', EventsWeekSummary::boundaries_containing( '2026-09-06', 1 )['start'] );
		$this->assertSame( '2026-09-06', EventsWeekSummary::boundaries_containing( '2026-09-06', 0 )['start'] );
		$this->assertSame( '2026-09-05', EventsWeekSummary::boundaries_containing( '2026-09-06', 6 )['start'] );
	}

	/** Weeks crossing a year keep both years' dates. */
	public function test_boundaries_containing_across_year_end() {
		$this->assertSame(
			array(
				'start' => '2026-12-28',
				'end'   => '2027-01-03',
			),
			EventsWeekSummary::boundaries_containing( '2027-01-01', 1 )
		);
	}

	/** Offsetting crosses ISO year boundaries. */
	public function test_offset_iso_week_crosses_year() {
		$this->assertSame(
			array(
				'year' => 2027,
				'week' => 1,
			),
			EventsWeekSummary::offset_iso_week( 2026, 53, 1 )
		);
	}

	/** Titles compress a single-month range. */
	public function test_range_title_within_one_month() {
		$this->assertSame( '14–20 Sep 2026', EventsWeekSummary::range_title( '2026-09-14', '2026-09-20' ) );
	}

	/** Titles name both months and the final year across a boundary. */
	public function test_range_title_across_months_and_years() {
		$this->assertSame( '31 Aug – 6 Sep 2026', EventsWeekSummary::range_title( '2026-08-31', '2026-09-06' ) );
		$this->assertSame( '28 Dec – 3 Jan 2027', EventsWeekSummary::range_title( '2026-12-28', '2027-01-03' ) );
	}

	/** A site west of UTC shows the same calendar days, not the previous ones. */
	public function test_range_title_in_negative_utc_offset_timezone() {
		$GLOBALS['_fair_test_timezone'] = 'America/Los_Angeles';

		$this->assertSame( '14–20 Sep 2026', EventsWeekSummary::range_title( '2026-09-14', '2026-09-20' ) );
	}

	/** A site east of UTC shows the same calendar days, not the next ones. */
	public function test_range_title_in_positive_utc_offset_timezone() {
		$GLOBALS['_fair_test_timezone'] = 'Pacific/Auckland';

		$this->assertSame( '14–20 Sep 2026', EventsWeekSummary::range_title( '2026-09-14', '2026-09-20' ) );
	}

	/** Formatting matches the formatter with the block's own heading. */
	public function test_format_matches_the_block_summary() {
		$occurrences = array(
			array(
				'title'   => 'Workshop',
				'start'   => '2026-09-01 18:30:00',
				'end'     => '2026-09-01 20:00:00',
				'all_day' => false,
				'url'     => 'https://example.com/workshop',
			),
		);
		$boundaries  = EventsWeekSummary::iso_week_boundaries( 2026, 36, 1 );

		$this->assertSame(
			EventsWeekSummaryFormatter::format( $occurrences, '2026-08-31 00:00:00', '2026-09-06 23:59:59', 'Events (https://example.com/events)', '31 Aug – 6 Sep 2026' ),
			EventsWeekSummary::format( $occurrences, $boundaries, 'Events (https://example.com/events)' )
		);
	}
}
