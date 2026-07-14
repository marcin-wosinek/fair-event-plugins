<?php
/**
 * RecurrenceService unit tests
 *
 * Covers generate_occurrences() behaviour (no DB) and the anchor-date
 * matching logic that reconcile_occurrences() depends on.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\RecurrenceService;

/**
 * Tests for RecurrenceService
 */
class RecurrenceServiceTest extends TestCase {

	// -----------------------------------------------------------------------
	// generate_occurrences — basic invariants
	// -----------------------------------------------------------------------

	/**
	 * Weekly COUNT=3 produces exactly 3 occurrences on consecutive weeks.
	 */
	public function test_generate_weekly_count() {
		$occurrences = RecurrenceService::generate_occurrences(
			'2035-03-01 10:00:00',
			'2035-03-01 12:00:00',
			'FREQ=WEEKLY;COUNT=3'
		);

		$this->assertCount( 3, $occurrences );
		$this->assertSame( '2035-03-01T10:00:00', $occurrences[0]['start'] );
		$this->assertSame( '2035-03-08T10:00:00', $occurrences[1]['start'] );
		$this->assertSame( '2035-03-15T10:00:00', $occurrences[2]['start'] );
	}

	/**
	 * Anchor date (Y-m-d of the start) is invariant under time-of-day shift.
	 *
	 * If the master time shifts from 10:00 to 11:00, the anchor dates for a
	 * weekly COUNT=3 series must still be 2035-03-01, 2035-03-08, 2035-03-15.
	 * This is what lets reconcile_occurrences() match existing rows after a shift.
	 */
	public function test_anchor_dates_unchanged_by_time_shift() {
		$before = RecurrenceService::generate_occurrences(
			'2035-03-01 10:00:00',
			'2035-03-01 12:00:00',
			'FREQ=WEEKLY;COUNT=3'
		);
		$after  = RecurrenceService::generate_occurrences(
			'2035-03-01 11:00:00',
			'2035-03-01 13:00:00',
			'FREQ=WEEKLY;COUNT=3'
		);

		$anchors_before = array_map(
			fn( $occ ) => ( new \DateTime( $occ['start'] ) )->format( 'Y-m-d' ),
			$before
		);
		$anchors_after  = array_map(
			fn( $occ ) => ( new \DateTime( $occ['start'] ) )->format( 'Y-m-d' ),
			$after
		);

		$this->assertSame( $anchors_before, $anchors_after );
	}

	/**
	 * Shortening COUNT from 4 to 2 removes the last 2 anchors.
	 *
	 * Reconcile_occurrences() uses exactly this difference to know which rows
	 * to delete: the anchors in the existing set but not in the desired set.
	 */
	public function test_shorten_rrule_drops_tail_anchors() {
		$full  = RecurrenceService::generate_occurrences(
			'2035-03-01 10:00:00',
			'2035-03-01 12:00:00',
			'FREQ=WEEKLY;COUNT=4'
		);
		$short = RecurrenceService::generate_occurrences(
			'2035-03-01 10:00:00',
			'2035-03-01 12:00:00',
			'FREQ=WEEKLY;COUNT=2'
		);

		$anchors_full  = array_map( fn( $o ) => ( new \DateTime( $o['start'] ) )->format( 'Y-m-d' ), $full );
		$anchors_short = array_map( fn( $o ) => ( new \DateTime( $o['start'] ) )->format( 'Y-m-d' ), $short );

		// Short set must be a leading subset of the full set.
		$this->assertSame( array_slice( $anchors_full, 0, 2 ), $anchors_short );

		// The anchors that would be removed are the tail.
		$removed = array_diff( $anchors_full, $anchors_short );
		$this->assertCount( 2, $removed );
	}

	/**
	 * Exdates reduce the occurrence count but keep anchor dates consistent.
	 */
	public function test_exdate_skips_occurrence() {
		$occurrences = RecurrenceService::generate_occurrences(
			'2035-03-01 10:00:00',
			'2035-03-01 12:00:00',
			'FREQ=WEEKLY;COUNT=3',
			null,
			array( '2035-03-08' )
		);

		// Second occurrence excluded — only 2 returned.
		$this->assertCount( 2, $occurrences );

		$starts = array_map( fn( $o ) => substr( $o['start'], 0, 10 ), $occurrences );
		$this->assertNotContains( '2035-03-08', $starts );
		$this->assertContains( '2035-03-01', $starts );
		$this->assertContains( '2035-03-15', $starts );
	}

	// -----------------------------------------------------------------------
	// build_manual_occurrences — pure, no DB
	// -----------------------------------------------------------------------

	/**
	 * Dates are sorted ascending regardless of input order, each taking the
	 * reference row's time-of-day and duration.
	 */
	public function test_build_manual_occurrences_sorts_and_applies_time_and_duration() {
		$occurrences = RecurrenceService::build_manual_occurrences(
			'2035-03-01 10:00:00',
			'2035-03-01 12:00:00',
			array( '2035-03-15', '2035-03-01', '2035-03-08' )
		);

		$this->assertCount( 3, $occurrences );
		$this->assertSame( '2035-03-01T10:00:00', $occurrences[0]['start'] );
		$this->assertSame( '2035-03-01T12:00:00', $occurrences[0]['end'] );
		$this->assertSame( '2035-03-08T10:00:00', $occurrences[1]['start'] );
		$this->assertSame( '2035-03-15T10:00:00', $occurrences[2]['start'] );
	}

	/**
	 * Duplicate dates are collapsed to a single occurrence.
	 */
	public function test_build_manual_occurrences_deduplicates() {
		$occurrences = RecurrenceService::build_manual_occurrences(
			'2035-03-01 10:00:00',
			'2035-03-01 12:00:00',
			array( '2035-03-01', '2035-03-01' )
		);

		$this->assertCount( 1, $occurrences );
	}

	/**
	 * An empty date list produces no occurrences (caller falls back / no-ops).
	 */
	public function test_build_manual_occurrences_empty_list() {
		$occurrences = RecurrenceService::build_manual_occurrences(
			'2035-03-01 10:00:00',
			'2035-03-01 12:00:00',
			array()
		);

		$this->assertSame( array(), $occurrences );
	}
}
