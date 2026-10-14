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
}
