<?php
/**
 * Tests for OccurrenceDateParam.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\OccurrenceDateParam;
use FairEvents\Models\EventDates;

/**
 * Unit tests for the public `event_date` URL param format/parse/legacy logic.
 */
class OccurrenceDateParamTest extends TestCase {

	/**
	 * Format() derives Y-m-d from a row's start_datetime.
	 *
	 * @return void
	 */
	public function test_format_returns_y_m_d_from_start_datetime() {
		$row                 = new EventDates();
		$row->start_datetime = '2026-06-29 18:30:00';

		$this->assertSame( '2026-06-29', OccurrenceDateParam::format( $row ) );
	}

	/**
	 * Parse() accepts a strictly valid Y-m-d date.
	 *
	 * @return void
	 */
	public function test_parse_accepts_valid_date() {
		$this->assertSame( '2026-06-29', OccurrenceDateParam::parse( '2026-06-29' ) );
	}

	/**
	 * Parse() rejects the legacy dotted format.
	 *
	 * @return void
	 */
	public function test_parse_rejects_dotted_format() {
		$this->assertNull( OccurrenceDateParam::parse( '2026.06.29' ) );
	}

	/**
	 * Parse() rejects an out-of-range date instead of silently rolling it over.
	 *
	 * @return void
	 */
	public function test_parse_rejects_out_of_range_date() {
		$this->assertNull( OccurrenceDateParam::parse( '2026-13-40' ) );
	}

	/**
	 * Parse() rejects garbage and empty input.
	 *
	 * @return void
	 */
	public function test_parse_rejects_garbage_and_empty() {
		$this->assertNull( OccurrenceDateParam::parse( 'not-a-date' ) );
		$this->assertNull( OccurrenceDateParam::parse( '' ) );
	}

	/**
	 * Is_legacy_id() distinguishes all-digit ids from dashed dates.
	 *
	 * @return void
	 */
	public function test_is_legacy_id_distinguishes_ids_from_dates() {
		$this->assertTrue( OccurrenceDateParam::is_legacy_id( '16' ) );
		$this->assertFalse( OccurrenceDateParam::is_legacy_id( '2026-06-29' ) );
	}
}
