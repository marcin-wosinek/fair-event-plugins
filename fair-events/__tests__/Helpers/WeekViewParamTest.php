<?php
/**
 * Tests for WeekViewParam.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\WeekViewParam;

/**
 * Unit tests for the `week_view` URL param parse/format/current logic.
 */
class WeekViewParamTest extends TestCase {

	/**
	 * A valid ISO week string parses into its year/week parts.
	 *
	 * @return void
	 */
	public function test_parse_accepts_valid_iso_week() {
		$this->assertSame(
			array(
				'year' => 2026,
				'week' => 33,
			),
			WeekViewParam::parse( '2026-W33' )
		);
	}

	/**
	 * An out-of-range year or week is rejected.
	 *
	 * @return void
	 */
	public function test_parse_rejects_out_of_range_values() {
		$this->assertNull( WeekViewParam::parse( '1899-W01' ) );
		$this->assertNull( WeekViewParam::parse( '2101-W01' ) );
		$this->assertNull( WeekViewParam::parse( '2026-W00' ) );
		$this->assertNull( WeekViewParam::parse( '2026-W54' ) );
	}

	/**
	 * Garbage/empty input is rejected.
	 *
	 * @return void
	 */
	public function test_parse_rejects_garbage_and_empty() {
		$this->assertNull( WeekViewParam::parse( '' ) );
		$this->assertNull( WeekViewParam::parse( '2026-08' ) );
		$this->assertNull( WeekViewParam::parse( 'not-a-week' ) );
	}

	/**
	 * Format() and parse() round-trip.
	 *
	 * @return void
	 */
	public function test_format_and_parse_round_trip() {
		$formatted = WeekViewParam::format( 2026, 33 );

		$this->assertSame( '2026-W33', $formatted );
		$this->assertSame(
			array(
				'year' => 2026,
				'week' => 33,
			),
			WeekViewParam::parse( $formatted )
		);
	}

	/**
	 * Format() zero-pads single-digit week numbers.
	 *
	 * @return void
	 */
	public function test_format_zero_pads_week_number() {
		$this->assertSame( '2026-W05', WeekViewParam::format( 2026, 5 ) );
	}

	/**
	 * Current() returns today's ISO year/week.
	 *
	 * @return void
	 */
	public function test_current_returns_todays_iso_year_and_week() {
		$now = new \DateTime( 'now', new \DateTimeZone( wp_timezone_string() ) );

		$this->assertSame(
			array(
				'year' => (int) $now->format( 'o' ),
				'week' => (int) $now->format( 'W' ),
			),
			WeekViewParam::current()
		);
	}
}
