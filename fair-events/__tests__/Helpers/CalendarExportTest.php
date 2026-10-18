<?php
/**
 * CalendarExport unit tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\CalendarExport;

/**
 * Tests for CalendarExport
 */
class CalendarExportTest extends TestCase {

	/**
	 * Build a canonical timing.
	 *
	 * @param string      $start_date Start date.
	 * @param string|null $start_time Start time.
	 * @param string|null $end_time   End time.
	 * @param bool        $all_day    All-day flag.
	 * @param string|null $end_date   End date (defaults to the start date).
	 * @return array Canonical timing.
	 */
	private function timing( $start_date, $start_time, $end_time, $all_day = false, $end_date = null ) {
		return array(
			'start_date' => $start_date,
			'end_date'   => $end_date ?? $start_date,
			'start_time' => $start_time,
			'end_time'   => $end_time,
			'all_day'    => $all_day,
		);
	}

	/**
	 * A series is exported with its rule only when every date is
	 * exportable.
	 */
	public function test_all_exportable() {
		$timed   = $this->timing( '2026-11-02', '18:00:00', '20:00:00' );
		$all_day = $this->timing( '2026-11-09', null, null, true );

		$this->assertTrue( CalendarExport::all_exportable( array( $timed, $all_day ) ) );
		$this->assertTrue( CalendarExport::all_exportable( array() ) );
		$this->assertFalse( CalendarExport::all_exportable( array( $timed, $this->timing( '2026-11-09', '18:00:00', null ) ) ) );
		$this->assertFalse( CalendarExport::all_exportable( array( $this->timing( '2026-11-02', null, '20:00:00' ), $timed ) ) );
		$this->assertFalse( CalendarExport::all_exportable( array( $this->timing( '2026-11-02', null, null ) ) ) );
	}

	/**
	 * The next exportable date skips dates without both times and dates
	 * that have ended, and keeps the caller's keys.
	 */
	public function test_next_exportable_skips_ineligible_and_ended_dates() {
		$timings = array(
			10 => $this->timing( '2026-11-02', '18:00:00', '20:00:00' ),
			11 => $this->timing( '2026-11-09', '18:00:00', null ),
			12 => $this->timing( '2026-11-16', '18:00:00', '20:00:00' ),
			13 => $this->timing( '2026-11-23', '18:00:00', '20:00:00' ),
		);

		$this->assertSame( 10, CalendarExport::next_exportable( $timings, '2026-11-01 12:00:00' ) );
		$this->assertSame( 10, CalendarExport::next_exportable( $timings, '2026-11-02 19:00:00' ) );
		$this->assertSame( 12, CalendarExport::next_exportable( $timings, '2026-11-02 20:00:01' ) );
		$this->assertNull( CalendarExport::next_exportable( $timings, '2026-11-23 21:00:00' ) );
	}

	/**
	 * An eligible override of an otherwise ineligible series is exported,
	 * whatever its order in the list; all-day dates last through their end
	 * date, and multi-day dates through their end time.
	 */
	public function test_next_exportable_orders_by_start_and_uses_the_real_end() {
		$timings = array(
			$this->timing( '2026-11-02', null, null ),
			$this->timing( '2026-11-20', '10:00:00', '12:00:00' ),
			$this->timing( '2026-11-10', null, null, true, '2026-11-12' ),
			$this->timing( '2026-11-05', '22:00:00', '02:00:00', false, '2026-11-06' ),
		);

		$this->assertSame( 3, CalendarExport::next_exportable( $timings, '2026-11-06 01:00:00' ) );
		$this->assertSame( 2, CalendarExport::next_exportable( $timings, '2026-11-06 02:00:01' ) );
		$this->assertSame( 2, CalendarExport::next_exportable( $timings, '2026-11-12 23:00:00' ) );
		$this->assertSame( 1, CalendarExport::next_exportable( $timings, '2026-11-13 00:00:00' ) );
		$this->assertNull( CalendarExport::next_exportable( array( $this->timing( '2026-11-02', '18:00:00', null ) ), '2026-01-01 00:00:00' ) );
	}
}
