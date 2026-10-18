<?php
/**
 * EventTiming unit tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\EventTiming;

/**
 * Tests for EventTiming
 */
class EventTimingTest extends TestCase {

	/**
	 * Build a canonical timing.
	 *
	 * @param string|null $start_date Start date.
	 * @param string|null $end_date   End date.
	 * @param string|null $start_time Start time.
	 * @param string|null $end_time   End time.
	 * @param bool        $all_day    All-day flag.
	 * @return array Canonical timing.
	 */
	private function timing( $start_date, $end_date, $start_time, $end_time, $all_day = false ) {
		return array(
			'start_date' => $start_date,
			'end_date'   => $end_date,
			'start_time' => $start_time,
			'end_time'   => $end_time,
			'all_day'    => $all_day,
		);
	}

	/**
	 * Legacy timed values keep their times, including genuine midnight.
	 */
	public function test_from_legacy_keeps_times_and_genuine_midnight() {
		$this->assertSame(
			$this->timing( '2026-11-02', '2026-11-02', '00:00:00', '02:30:00' ),
			EventTiming::from_legacy( '2026-11-02 00:00:00', '2026-11-02 02:30:00', false )
		);
	}

	/**
	 * A legacy all-day row keeps its inclusive dates and loses its placeholder times.
	 */
	public function test_from_legacy_all_day_has_dates_without_times() {
		$this->assertSame(
			$this->timing( '2026-11-02', '2026-11-04', null, null, true ),
			EventTiming::from_legacy( '2026-11-02 00:00:00', '2026-11-04 00:00:00', true )
		);
	}

	/**
	 * A legacy row without an end keeps its same-day meaning with no end time.
	 */
	public function test_from_legacy_without_end_is_same_day_without_end_time() {
		$this->assertSame(
			$this->timing( '2026-11-02', '2026-11-02', '19:00:00', null ),
			EventTiming::from_legacy( '2026-11-02T19:00:00', null, false )
		);
	}

	/**
	 * A legacy row without a start stays undated.
	 */
	public function test_from_legacy_without_start_is_undated() {
		$this->assertSame( EventTiming::undated(), EventTiming::from_legacy( null, null, false ) );
		$this->assertSame( EventTiming::undated(), EventTiming::from_legacy( 'not a date', '2026-11-02 10:00:00', false ) );
	}

	/**
	 * Wall-clock values never shift, even on a daylight-saving transition day
	 * in a non-UTC default timezone.
	 */
	public function test_from_legacy_does_not_shift_dates_on_dst_boundary() {
		$previous = date_default_timezone_get();
		date_default_timezone_set( 'Europe/Madrid' ); // phpcs:ignore WordPress.DateTime.RestrictedFunctions.timezone_change_date_default_timezone_set -- the test asserts nothing depends on the PHP default timezone.

		try {
			$this->assertSame(
				$this->timing( '2026-03-29', '2026-03-30', '23:30:00', '02:30:00' ),
				EventTiming::from_legacy( '2026-03-29 23:30:00', '2026-03-30 02:30:00', false )
			);
		} finally {
			date_default_timezone_set( $previous ); // phpcs:ignore WordPress.DateTime.RestrictedFunctions.timezone_change_date_default_timezone_set -- restores the default changed above.
		}
	}

	/**
	 * Legacy values for each of the four time combinations.
	 */
	public function test_to_legacy_covers_all_four_time_combinations() {
		$this->assertSame(
			array(
				'start_datetime' => '2026-11-02 18:00:00',
				'end_datetime'   => '2026-11-02 20:00:00',
			),
			EventTiming::to_legacy( $this->timing( '2026-11-02', '2026-11-02', '18:00:00', '20:00:00' ) )
		);
		$this->assertSame(
			array(
				'start_datetime' => '2026-11-02 18:00:00',
				'end_datetime'   => null,
			),
			EventTiming::to_legacy( $this->timing( '2026-11-02', '2026-11-02', '18:00:00', null ) )
		);
		$this->assertSame(
			array(
				'start_datetime' => '2026-11-02 00:00:00',
				'end_datetime'   => '2026-11-02 20:00:00',
			),
			EventTiming::to_legacy( $this->timing( '2026-11-02', '2026-11-02', null, '20:00:00' ) )
		);
		$this->assertSame(
			array(
				'start_datetime' => '2026-11-02 00:00:00',
				'end_datetime'   => null,
			),
			EventTiming::to_legacy( $this->timing( '2026-11-02', '2026-11-02', null, null ) )
		);
	}

	/**
	 * A multi-day event without an end time keeps its whole last day for
	 * legacy date-range readers; all-day rows use the legacy convention.
	 */
	public function test_to_legacy_multi_day_and_all_day() {
		$this->assertSame(
			array(
				'start_datetime' => '2026-11-02 18:00:00',
				'end_datetime'   => '2026-11-04 23:59:59',
			),
			EventTiming::to_legacy( $this->timing( '2026-11-02', '2026-11-04', '18:00:00', null ) )
		);
		$this->assertSame(
			array(
				'start_datetime' => '2026-11-02 00:00:00',
				'end_datetime'   => '2026-11-04 00:00:00',
			),
			EventTiming::to_legacy( $this->timing( '2026-11-02', '2026-11-04', null, null, true ) )
		);
		$this->assertSame(
			array(
				'start_datetime' => null,
				'end_datetime'   => null,
			),
			EventTiming::to_legacy( EventTiming::undated() )
		);
	}

	/**
	 * A migrated row is read from its canonical columns, so the legacy
	 * substitute never refills an absent time.
	 */
	public function test_from_row_reads_migrated_row_from_canonical_columns() {
		$row = (object) array(
			'timing_migrated' => '1',
			'start_datetime'  => '2026-11-02 00:00:00',
			'end_datetime'    => null,
			'all_day'         => '0',
			'start_date'      => '2026-11-02',
			'end_date'        => '2026-11-02',
			'start_time'      => null,
			'end_time'        => null,
		);

		$this->assertSame( $this->timing( '2026-11-02', '2026-11-02', null, null ), EventTiming::from_row( $row ) );
	}

	/**
	 * A migrated row with a time at midnight keeps genuine midnight.
	 */
	public function test_from_row_keeps_genuine_midnight() {
		$row = (object) array(
			'timing_migrated' => '1',
			'all_day'         => '0',
			'start_date'      => '2026-11-02',
			'end_date'        => '2026-11-03',
			'start_time'      => '00:00:00',
			'end_time'        => '00:00:00',
		);

		$this->assertSame( $this->timing( '2026-11-02', '2026-11-03', '00:00:00', '00:00:00' ), EventTiming::from_row( $row ) );
	}

	/**
	 * A row written before the timing columns existed is read from its
	 * legacy columns.
	 */
	public function test_from_row_reads_unmigrated_row_from_legacy_columns() {
		$row = (object) array(
			'timing_migrated' => '0',
			'start_datetime'  => '2026-11-02 18:00:00',
			'end_datetime'    => '2026-11-02 20:00:00',
			'all_day'         => '0',
			'start_date'      => null,
			'end_date'        => null,
			'start_time'      => null,
			'end_time'        => null,
		);

		$this->assertSame( $this->timing( '2026-11-02', '2026-11-02', '18:00:00', '20:00:00' ), EventTiming::from_row( $row ) );
	}

	/**
	 * Columns carry the canonical values, the legacy values in step and the marker.
	 */
	public function test_columns_write_both_groups_and_marker() {
		$this->assertSame(
			array(
				'start_date'      => '2026-11-02',
				'end_date'        => '2026-11-02',
				'start_time'      => null,
				'end_time'        => '20:00:00',
				'all_day'         => 0,
				'start_datetime'  => '2026-11-02 00:00:00',
				'end_datetime'    => '2026-11-02 20:00:00',
				'timing_migrated' => 1,
			),
			EventTiming::columns( $this->timing( '2026-11-02', '2026-11-02', null, '20:00:00' ) )
		);
		$this->assertCount( count( EventTiming::columns( EventTiming::undated() ) ), EventTiming::column_formats() );
	}

	/**
	 * Omitted keys keep their value; an explicit null clears it.
	 */
	public function test_merge_distinguishes_omitted_from_null() {
		$current = $this->timing( '2026-11-02', '2026-11-02', '18:00:00', '20:00:00' );

		$this->assertSame(
			$this->timing( '2026-11-02', '2026-11-02', '18:00:00', null ),
			EventTiming::merge( $current, array( 'end_time' => null ) )
		);
		$this->assertSame(
			$this->timing( '2026-11-09', '2026-11-02', '18:00:00', '20:00:00' ),
			EventTiming::merge( $current, array( 'start_date' => '2026-11-09' ) )
		);
	}

	/**
	 * Making an event all-day drops its times; turning all-day off does not invent any.
	 */
	public function test_merge_all_day_drops_times_without_inventing_new_ones() {
		$timed   = $this->timing( '2026-11-02', '2026-11-02', '18:00:00', '20:00:00' );
		$all_day = EventTiming::merge( $timed, array( 'all_day' => true ) );

		$this->assertSame( $this->timing( '2026-11-02', '2026-11-02', null, null, true ), $all_day );
		$this->assertSame(
			$this->timing( '2026-11-02', '2026-11-02', null, null ),
			EventTiming::merge( $all_day, array( 'all_day' => false ) )
		);
	}

	/**
	 * A legacy start-only update moves a same-day open end with its start,
	 * as a null legacy end did.
	 */
	public function test_merge_legacy_open_end_follows_start() {
		$current = $this->timing( '2026-11-02', '2026-11-02', '18:00:00', null );

		$this->assertSame(
			$this->timing( '2026-11-09', '2026-11-09', '19:00:00', null ),
			EventTiming::merge_legacy( $current, array( 'start_datetime' => '2026-11-09 19:00:00' ) )
		);
	}

	/**
	 * A legacy start-only update keeps a real end unchanged.
	 */
	public function test_merge_legacy_keeps_explicit_end() {
		$current = $this->timing( '2026-11-02', '2026-11-03', '18:00:00', '02:00:00' );

		$this->assertSame(
			$this->timing( '2026-11-01', '2026-11-03', '18:00:00', '02:00:00' ),
			EventTiming::merge_legacy( $current, array( 'start_datetime' => '2026-11-01 18:00:00' ) )
		);
	}

	/**
	 * An empty legacy end means "no end"; legacy all-day values lose their times.
	 */
	public function test_merge_legacy_empty_end_and_all_day() {
		$current = $this->timing( '2026-11-02', '2026-11-03', '18:00:00', '02:00:00' );

		$this->assertSame(
			$this->timing( '2026-11-02', '2026-11-02', '18:00:00', null ),
			EventTiming::merge_legacy( $current, array( 'end_datetime' => '' ) )
		);
		$this->assertSame(
			$this->timing( '2026-11-05', '2026-11-06', null, null, true ),
			EventTiming::merge_legacy(
				$current,
				array(
					'start_datetime' => '2026-11-05 00:00:00',
					'end_datetime'   => '2026-11-06 00:00:00',
					'all_day'        => true,
				)
			)
		);
	}

	/**
	 * Request values are normalized; invalid ones are reported.
	 */
	public function test_normalize_changes() {
		$this->assertSame(
			array(
				'start_date' => '2026-11-02',
				'start_time' => '09:05:00',
				'end_time'   => null,
			),
			EventTiming::normalize_changes(
				array(
					'start_date' => '2026-11-02',
					'start_time' => '09:05',
					'end_time'   => null,
				)
			)
		);
		$this->assertSame( 'invalid_date', EventTiming::normalize_changes( array( 'start_date' => '2026-02-30' ) ) );
		$this->assertSame( 'invalid_date', EventTiming::normalize_changes( array( 'end_date' => '2026-11-02 10:00:00' ) ) );
		$this->assertSame( 'invalid_time', EventTiming::normalize_changes( array( 'start_time' => '24:00' ) ) );
		$this->assertSame( 'invalid_time', EventTiming::normalize_changes( array( 'end_time' => '7pm' ) ) );
	}

	/**
	 * All four time combinations, single- and multi-day, are valid.
	 */
	public function test_validate_accepts_all_combinations() {
		foreach ( array( '2026-11-02', '2026-11-04' ) as $end_date ) {
			$this->assertNull( EventTiming::validate( $this->timing( '2026-11-02', $end_date, '18:00:00', '20:00:00' ) ) );
			$this->assertNull( EventTiming::validate( $this->timing( '2026-11-02', $end_date, '18:00:00', null ) ) );
			$this->assertNull( EventTiming::validate( $this->timing( '2026-11-02', $end_date, null, '20:00:00' ) ) );
			$this->assertNull( EventTiming::validate( $this->timing( '2026-11-02', $end_date, null, null ) ) );
		}
		$this->assertNull( EventTiming::validate( EventTiming::undated() ) );
		$this->assertNull( EventTiming::validate( $this->timing( '2026-11-02', '2026-11-02', null, null, true ) ) );
	}

	/**
	 * Invalid ranges are rejected; missing times never take part in the
	 * ordering check, and a multi-day event may end earlier in the day.
	 */
	public function test_validate_rejects_reversed_ranges_only() {
		$this->assertSame( 'end_date_before_start', EventTiming::validate( $this->timing( '2026-11-02', '2026-11-01', null, null ) ) );
		$this->assertSame( 'end_time_before_start', EventTiming::validate( $this->timing( '2026-11-02', '2026-11-02', '20:00:00', '18:00:00' ) ) );
		$this->assertNull( EventTiming::validate( $this->timing( '2026-11-02', '2026-11-02', '20:00:00', '20:00:00' ) ) );
		$this->assertNull( EventTiming::validate( $this->timing( '2026-11-02', '2026-11-03', '20:00:00', '02:00:00' ) ) );
		$this->assertNull( EventTiming::validate( $this->timing( '2026-11-02', '2026-11-02', null, '00:00:00' ) ) );
		$this->assertNull( EventTiming::validate( $this->timing( '2026-11-02', '2026-11-02', '23:00:00', null ) ) );
	}

	/**
	 * Structural errors: times on an all-day event, values without a start date.
	 */
	public function test_validate_rejects_inconsistent_timing() {
		$this->assertSame( 'all_day_times', EventTiming::validate( $this->timing( '2026-11-02', '2026-11-02', '18:00:00', null, true ) ) );
		$this->assertSame( 'start_date_required', EventTiming::validate( $this->timing( null, '2026-11-02', null, null ) ) );
		$this->assertSame( 'start_date_required', EventTiming::validate( $this->timing( null, null, '18:00:00', null ) ) );
	}

	/**
	 * Only explicitly all-day or fully timed events are exportable to
	 * calendars, single- and multi-day; genuine midnight counts as a time.
	 */
	public function test_is_calendar_exportable() {
		foreach ( array( '2026-11-02', '2026-11-04' ) as $end_date ) {
			$this->assertTrue( EventTiming::is_calendar_exportable( $this->timing( '2026-11-02', $end_date, '18:00:00', '20:00:00' ) ) );
			$this->assertFalse( EventTiming::is_calendar_exportable( $this->timing( '2026-11-02', $end_date, '18:00:00', null ) ) );
			$this->assertFalse( EventTiming::is_calendar_exportable( $this->timing( '2026-11-02', $end_date, null, '20:00:00' ) ) );
			$this->assertFalse( EventTiming::is_calendar_exportable( $this->timing( '2026-11-02', $end_date, null, null ) ) );
			$this->assertTrue( EventTiming::is_calendar_exportable( $this->timing( '2026-11-02', $end_date, null, null, true ) ) );
		}
		$this->assertTrue( EventTiming::is_calendar_exportable( $this->timing( '2026-11-02', '2026-11-03', '00:00:00', '00:00:00' ) ) );
		$this->assertTrue( EventTiming::is_calendar_exportable( EventTiming::from_legacy( '2026-11-02 00:00:00', '2026-11-02 23:00:00', false ) ) );
		$this->assertFalse( EventTiming::is_calendar_exportable( EventTiming::from_legacy( '2026-11-02 18:00:00', null, false ) ) );
		$this->assertFalse( EventTiming::is_calendar_exportable( EventTiming::undated() ) );
	}

	/**
	 * Moving a timing keeps its calendar-day span, its optional times and
	 * its all-day flag, across month and leap-day boundaries.
	 */
	public function test_for_date_keeps_span_and_times() {
		$this->assertSame(
			$this->timing( '2028-03-01', '2028-03-02', '22:00:00', null ),
			EventTiming::for_date( $this->timing( '2028-02-28', '2028-02-29', '22:00:00', null ), '2028-03-01' )
		);
		$this->assertSame(
			$this->timing( '2026-12-31', '2027-01-02', null, null, true ),
			EventTiming::for_date( $this->timing( '2026-11-02', '2026-11-04', null, null, true ), '2026-12-31' )
		);
	}

	/**
	 * Calendar-day arithmetic is wall-clock, untouched by DST changes.
	 */
	public function test_day_arithmetic() {
		$this->assertSame( '2026-03-30', EventTiming::add_days( '2026-03-28', 2 ) );
		$this->assertSame( '2026-10-24', EventTiming::add_days( '2026-10-26', -2 ) );
		$this->assertSame( 2, EventTiming::days_between( '2026-03-28', '2026-03-30' ) );
		$this->assertSame( -7, EventTiming::days_between( '2026-11-09', '2026-11-02' ) );
	}

	/**
	 * An occurrence takes each group from its series for its anchor date,
	 * unless it overrides that group; overridden times include all-day.
	 */
	public function test_resolve_occurrence() {
		$series = $this->timing( '2026-11-02', '2026-11-02', '18:00:00', '20:00:00' );
		$own    = $this->timing( '2026-11-10', '2026-11-11', null, '21:00:00' );

		$this->assertSame(
			$this->timing( '2026-11-09', '2026-11-09', '18:00:00', '20:00:00' ),
			EventTiming::resolve_occurrence(
				$series,
				'2026-11-09',
				$own,
				array(
					'dates' => false,
					'times' => false,
				)
			)
		);
		$this->assertSame(
			$this->timing( '2026-11-10', '2026-11-11', '18:00:00', '20:00:00' ),
			EventTiming::resolve_occurrence(
				$series,
				'2026-11-09',
				$own,
				array(
					'dates' => true,
					'times' => false,
				)
			)
		);
		$this->assertSame(
			$this->timing( '2026-11-09', '2026-11-09', null, '21:00:00' ),
			EventTiming::resolve_occurrence(
				$series,
				'2026-11-09',
				$own,
				array(
					'dates' => false,
					'times' => true,
				)
			)
		);
		$this->assertSame(
			$this->timing( '2026-11-09', '2026-11-09', null, null, true ),
			EventTiming::resolve_occurrence( $series, '2026-11-09', $this->timing( '2026-11-09', '2026-11-09', null, null, true ), array( 'times' => true ) )
		);
	}

	/**
	 * Changed groups: dates, and times together with all-day; clearing a
	 * time is a change.
	 */
	public function test_changed_groups() {
		$base = $this->timing( '2026-11-02', '2026-11-02', '18:00:00', '20:00:00' );

		$this->assertSame(
			array(
				'dates' => false,
				'times' => false,
			),
			EventTiming::changed_groups( $base, $base )
		);
		$this->assertSame(
			array(
				'dates' => true,
				'times' => false,
			),
			EventTiming::changed_groups( $base, $this->timing( '2026-11-02', '2026-11-03', '18:00:00', '20:00:00' ) )
		);
		$this->assertSame(
			array(
				'dates' => false,
				'times' => true,
			),
			EventTiming::changed_groups( $base, $this->timing( '2026-11-02', '2026-11-02', '18:00:00', null ) )
		);
		$this->assertSame(
			array(
				'dates' => false,
				'times' => true,
			),
			EventTiming::changed_groups( $base, $this->timing( '2026-11-02', '2026-11-02', null, null, true ) )
		);
	}

	/**
	 * Override markers are read from their columns.
	 */
	public function test_overrides_from_row() {
		$this->assertSame(
			array(
				'dates' => false,
				'times' => true,
			),
			EventTiming::overrides_from_row( (object) array( 'times_override' => '1' ) )
		);
	}
}
