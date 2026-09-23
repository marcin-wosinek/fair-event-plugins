<?php
/**
 * Tests for RecurrenceSummary's schedule text.
 *
 * Dates are in 2040 so DateRangeFormatter always appends the year
 * (it omits the current year), keeping expectations deterministic.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\RecurrenceSummary;

/**
 * Unit tests for RecurrenceSummary.
 */
class RecurrenceSummaryTest extends TestCase {

	/**
	 * Reset the site timezone stub.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );

		parent::tearDown();
	}

	/**
	 * Build series metadata, overridable per test.
	 *
	 * @param array $overrides Fields to override.
	 * @return array
	 */
	private function series( array $overrides = array() ) {
		return array_merge(
			array(
				'id'              => 7,
				'rrule'           => 'FREQ=WEEKLY;COUNT=10',
				'recurrence_mode' => 'rule',
				'anchor_start'    => '2040-01-02 18:00:00',
				'all_day'         => false,
			),
			$overrides
		);
	}

	/**
	 * Build a selected occurrence.
	 *
	 * @param string $start   Start.
	 * @param string $end     End.
	 * @param bool   $all_day All-day flag.
	 * @return array
	 */
	private function occurrence( $start, $end, $all_day = false ) {
		return array(
			'start'   => $start,
			'end'     => $end,
			'all_day' => $all_day,
		);
	}

	/**
	 * Weekly series: weekday from the anchor, time from the anchor, next date only.
	 */
	public function test_weekly_series_summary() {
		$this->assertSame(
			'Weekly on Mondays at 18:00; next occurrence: 1 October 2040',
			RecurrenceSummary::format( $this->series(), $this->occurrence( '2040-10-01 18:00:00', '2040-10-01 20:00:00' ) )
		);
	}

	/**
	 * Every-N-weeks rule uses the plural interval form.
	 */
	public function test_weekly_interval_schedule() {
		$this->assertSame(
			'Every 2 weeks on Mondays at 18:00',
			RecurrenceSummary::format_schedule( $this->series( array( 'rrule' => 'FREQ=WEEKLY;INTERVAL=2' ) ) )
		);
	}

	/**
	 * Daily rules, with and without an interval.
	 */
	public function test_daily_schedules() {
		$this->assertSame( 'Daily at 18:00', RecurrenceSummary::format_schedule( $this->series( array( 'rrule' => 'FREQ=DAILY;COUNT=5' ) ) ) );
		$this->assertSame( 'Every 3 days at 18:00', RecurrenceSummary::format_schedule( $this->series( array( 'rrule' => 'FREQ=DAILY;INTERVAL=3' ) ) ) );
	}

	/**
	 * Monthly rules repeat on the anchor's day of month.
	 */
	public function test_monthly_schedules() {
		$this->assertSame( 'Monthly on day 2 at 18:00', RecurrenceSummary::format_schedule( $this->series( array( 'rrule' => 'FREQ=MONTHLY' ) ) ) );
		$this->assertSame( 'Every 2 months on day 2 at 18:00', RecurrenceSummary::format_schedule( $this->series( array( 'rrule' => 'FREQ=MONTHLY;INTERVAL=2' ) ) ) );
	}

	/**
	 * All-day series omit clock times, in the schedule and the next date.
	 */
	public function test_all_day_series_omits_times() {
		$series = $this->series(
			array(
				'anchor_start' => '2040-01-02 00:00:00',
				'all_day'      => true,
			)
		);

		$this->assertSame(
			'Weekly on Mondays; next occurrence: 1 October 2040',
			RecurrenceSummary::format( $series, $this->occurrence( '2040-10-01 00:00:00', '2040-10-01 23:59:59', true ) )
		);
	}

	/**
	 * Manually selected dates never invent a frequency.
	 */
	public function test_manual_dates_use_generic_line() {
		$series = $this->series(
			array(
				'rrule'           => null,
				'recurrence_mode' => 'manual',
			)
		);

		$this->assertSame(
			'Recurring event; next occurrence: 18:00—20:00, 1 October 2040',
			RecurrenceSummary::format( $series, $this->occurrence( '2040-10-01 18:00:00', '2040-10-01 20:00:00' ) )
		);
	}

	/**
	 * A rule this formatter can't describe falls back to the generic line.
	 */
	public function test_unsupported_rule_uses_generic_line() {
		$this->assertSame( '', RecurrenceSummary::format_schedule( $this->series( array( 'rrule' => 'FREQ=YEARLY' ) ) ) );
	}

	/**
	 * A rescheduled occurrence keeps the regular schedule and shows its own
	 * (different) time in the next-occurrence part.
	 */
	public function test_rescheduled_occurrence_keeps_regular_schedule() {
		$this->assertSame(
			'Weekly on Mondays at 18:00; next occurrence: 19:00—21:00, 3 October 2040',
			RecurrenceSummary::format( $this->series(), $this->occurrence( '2040-10-03 19:00:00', '2040-10-03 21:00:00' ) )
		);
	}

	/**
	 * Europe/Madrid wall-clock time is kept across the October DST change.
	 */
	public function test_schedule_keeps_wall_clock_time_across_dst() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		$series = $this->series( array( 'anchor_start' => '2040-09-03 18:00:00' ) );

		$this->assertSame(
			'Weekly on Mondays at 18:00; next occurrence: 29 October 2040',
			RecurrenceSummary::format( $series, $this->occurrence( '2040-10-29 18:00:00', '2040-10-29 20:00:00' ) )
		);
	}
}
