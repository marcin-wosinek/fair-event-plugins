<?php
/**
 * Tests for DateRangeFormatter.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\DateRangeFormatter;

/**
 * The current year is omitted by default and shown when a caller asks for
 * it (a selected session, which may be in any year).
 */
class DateRangeFormatterTest extends TestCase {

	/**
	 * The current year, as the formatter sees it.
	 *
	 * @var string
	 */
	private $year;

	/**
	 * Resolve the current year in the (UTC) test timezone.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$this->year = gmdate( 'Y' );
	}

	/**
	 * By default a current-year timed range omits the year.
	 *
	 * @return void
	 */
	public function test_current_year_is_omitted_by_default() {
		$this->assertSame(
			'19:30—21:30, 15 October',
			DateRangeFormatter::format( $this->year . '-10-15 19:30:00', $this->year . '-10-15 21:30:00', false )
		);
	}

	/**
	 * A different year is shown even by default.
	 *
	 * @return void
	 */
	public function test_other_year_is_shown_by_default() {
		$other = (string) ( (int) $this->year - 1 );

		$this->assertSame(
			'19:30—21:30, 15 October ' . $other,
			DateRangeFormatter::format( $other . '-10-15 19:30:00', $other . '-10-15 21:30:00', false )
		);
	}

	/**
	 * The always-show-year mode adds the current year to a timed range.
	 *
	 * @return void
	 */
	public function test_always_show_year_on_timed_range() {
		$this->assertSame(
			'19:30—21:30, 15 October ' . $this->year,
			DateRangeFormatter::format( $this->year . '-10-15 19:30:00', $this->year . '-10-15 21:30:00', false, true )
		);
	}

	/**
	 * The always-show-year mode adds the year to both ends of an overnight
	 * range and to a start-only time.
	 *
	 * @return void
	 */
	public function test_always_show_year_on_overnight_and_open_ended_sessions() {
		$this->assertSame(
			'22:00 15 November ' . $this->year . '—03:00 16 November ' . $this->year,
			DateRangeFormatter::format( $this->year . '-11-15 22:00:00', $this->year . '-11-16 03:00:00', false, true )
		);
		$this->assertSame(
			'19:30, 15 October ' . $this->year,
			DateRangeFormatter::format( $this->year . '-10-15 19:30:00', null, false, true )
		);
	}

	/**
	 * The always-show-year mode adds the year to all-day dates and ranges.
	 *
	 * @return void
	 */
	public function test_always_show_year_on_all_day_sessions() {
		$this->assertSame(
			'15 October ' . $this->year,
			DateRangeFormatter::format( $this->year . '-10-15 00:00:00', null, true, true )
		);
		$this->assertSame(
			'26–28 June ' . $this->year,
			DateRangeFormatter::format( $this->year . '-06-26 00:00:00', $this->year . '-06-28 00:00:00', true, true )
		);
		$this->assertSame(
			'31 October—2 November ' . $this->year,
			DateRangeFormatter::format( $this->year . '-10-31 00:00:00', $this->year . '-11-02 00:00:00', true, true )
		);
	}

	/**
	 * Canonical timing for the format_timing() cases.
	 *
	 * @param string      $start_date Start date (month-day, current year).
	 * @param string      $end_date   End date (month-day, current year).
	 * @param string|null $start_time Start time.
	 * @param string|null $end_time   End time.
	 * @param bool        $all_day    All-day flag.
	 * @return array Timing.
	 */
	private function timing( $start_date, $end_date, $start_time, $end_time, $all_day = false ) {
		return array(
			'start_date' => $this->year . '-' . $start_date,
			'end_date'   => $this->year . '-' . $end_date,
			'start_time' => $start_time,
			'end_time'   => $end_time,
			'all_day'    => $all_day,
		);
	}

	/**
	 * Only supplied times are shown, for each of the four combinations,
	 * and genuine midnight is a time like any other.
	 *
	 * @return void
	 */
	public function test_format_timing_shows_only_supplied_times() {
		$this->assertSame( '19:30—21:30, 15 October', DateRangeFormatter::format_timing( $this->timing( '10-15', '10-15', '19:30:00', '21:30:00' ) ) );
		$this->assertSame( '19:30, 15 October', DateRangeFormatter::format_timing( $this->timing( '10-15', '10-15', '19:30:00', null ) ) );
		$this->assertSame( '15 October', DateRangeFormatter::format_timing( $this->timing( '10-15', '10-15', null, '21:30:00' ) ) );
		$this->assertSame( '15 October', DateRangeFormatter::format_timing( $this->timing( '10-15', '10-15', null, null ) ) );
		$this->assertSame( '00:00—02:00, 15 October', DateRangeFormatter::format_timing( $this->timing( '10-15', '10-15', '00:00:00', '02:00:00' ) ) );
	}

	/**
	 * Multi-day and all-day timings read as date ranges; an undated timing
	 * has no label.
	 *
	 * @return void
	 */
	public function test_format_timing_multi_day_all_day_and_undated() {
		$this->assertSame( '15–17 October', DateRangeFormatter::format_timing( $this->timing( '10-15', '10-17', null, null ) ) );
		$this->assertSame( '19:30, 15–17 October', DateRangeFormatter::format_timing( $this->timing( '10-15', '10-17', '19:30:00', null ) ) );
		$this->assertSame( '22:00 15 October—03:00 16 October', DateRangeFormatter::format_timing( $this->timing( '10-15', '10-16', '22:00:00', '03:00:00' ) ) );
		$this->assertSame( '31 October—2 November', DateRangeFormatter::format_timing( $this->timing( '10-31', '11-02', null, null, true ) ) );
		$this->assertSame(
			'',
			DateRangeFormatter::format_timing(
				array(
					'start_date' => null,
					'end_date'   => null,
					'start_time' => null,
					'end_time'   => null,
					'all_day'    => false,
				)
			)
		);
	}
}
