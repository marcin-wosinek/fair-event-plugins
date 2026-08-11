<?php
/**
 * Tests for CalendarMonthParam.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\CalendarMonthParam;

/**
 * Unit tests for the `calendar_month`/`calendar_year` URL param validation.
 */
class CalendarMonthParamTest extends TestCase {

	/**
	 * A valid month/year pair round-trips unchanged.
	 *
	 * @return void
	 */
	public function test_parse_accepts_valid_pair() {
		$this->assertSame(
			array(
				'month' => '08',
				'year'  => '2026',
			),
			CalendarMonthParam::parse( '08', '2026' )
		);
	}

	/**
	 * An out-of-range month is rejected.
	 *
	 * @return void
	 */
	public function test_parse_rejects_invalid_month() {
		$this->assertNull( CalendarMonthParam::parse( '13', '2026' ) );
		$this->assertNull( CalendarMonthParam::parse( '00', '2026' ) );
		$this->assertNull( CalendarMonthParam::parse( '8', '2026' ) );
	}

	/**
	 * A year outside 1900-2100, or not four digits, is rejected.
	 *
	 * @return void
	 */
	public function test_parse_rejects_invalid_year() {
		$this->assertNull( CalendarMonthParam::parse( '08', '1899' ) );
		$this->assertNull( CalendarMonthParam::parse( '08', '2101' ) );
		$this->assertNull( CalendarMonthParam::parse( '08', '26' ) );
	}

	/**
	 * Garbage/empty input is rejected.
	 *
	 * @return void
	 */
	public function test_parse_rejects_garbage_and_empty() {
		$this->assertNull( CalendarMonthParam::parse( '', '' ) );
		$this->assertNull( CalendarMonthParam::parse( 'aa', 'bbbb' ) );
	}

	/**
	 * Current() returns today's month/year in the same shape as parse().
	 *
	 * @return void
	 */
	public function test_current_returns_todays_month_and_year() {
		$current = CalendarMonthParam::current();

		$this->assertSame( current_time( 'm' ), $current['month'] );
		$this->assertSame( current_time( 'Y' ), $current['year'] );
	}
}
