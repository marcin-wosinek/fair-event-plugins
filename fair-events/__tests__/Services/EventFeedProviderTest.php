<?php
/**
 * EventFeedProvider::group_by_day() unit tests
 *
 * Pure-logic tests only — get_occurrences() requires a live WordPress
 * environment (get_post(), wp_get_post_terms(), wpdb) and is covered by the
 * WP-CLI eval-file manual check instead (see TESTING.md).
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\EventFeedProvider;

/**
 * Tests for EventFeedProvider::group_by_day()
 */
class EventFeedProviderTest extends TestCase {

	/**
	 * Build a minimal occurrence DTO for a single-day event.
	 *
	 * @param string $uid   Occurrence uid.
	 * @param string $start Naive 'Y-m-d H:i:s' start.
	 * @param string $end   Naive 'Y-m-d H:i:s' end.
	 * @return array Occurrence DTO.
	 */
	private function make_occurrence( $uid, $start, $end ) {
		return array(
			'uid'   => $uid,
			'start' => $start,
			'end'   => $end,
		);
	}

	/**
	 * A single-day occurrence lands in exactly one bucket, marked as both
	 * first and last day.
	 */
	public function test_single_day_occurrence_lands_in_one_bucket() {
		$occurrences = array(
			$this->make_occurrence( 'a', '2026-03-10 09:00:00', '2026-03-10 11:00:00' ),
		);

		$by_day = EventFeedProvider::group_by_day( $occurrences, '2026-03-01 00:00:00', '2026-03-31 23:59:59' );

		$this->assertArrayHasKey( '2026-03-10', $by_day );
		$this->assertCount( 1, $by_day['2026-03-10'] );
		$this->assertTrue( $by_day['2026-03-10'][0]['is_first_day'] );
		$this->assertTrue( $by_day['2026-03-10'][0]['is_last_day'] );
	}

	/**
	 * A multi-day occurrence is expanded into a bucket per spanned day, with
	 * is_first_day/is_last_day set only on the boundary days.
	 */
	public function test_multi_day_occurrence_expands_across_buckets() {
		$occurrences = array(
			$this->make_occurrence( 'a', '2026-03-10 09:00:00', '2026-03-12 17:00:00' ),
		);

		$by_day = EventFeedProvider::group_by_day( $occurrences, '2026-03-01 00:00:00', '2026-03-31 23:59:59' );

		$this->assertSame( array( '2026-03-10', '2026-03-11', '2026-03-12' ), array_keys( $by_day ) );

		$this->assertTrue( $by_day['2026-03-10'][0]['is_first_day'] );
		$this->assertFalse( $by_day['2026-03-10'][0]['is_last_day'] );

		$this->assertFalse( $by_day['2026-03-11'][0]['is_first_day'] );
		$this->assertFalse( $by_day['2026-03-11'][0]['is_last_day'] );

		$this->assertFalse( $by_day['2026-03-12'][0]['is_first_day'] );
		$this->assertTrue( $by_day['2026-03-12'][0]['is_last_day'] );
	}

	/**
	 * A multi-day occurrence is clipped to the requested range, not expanded
	 * past it.
	 */
	public function test_multi_day_occurrence_is_clipped_to_range() {
		$occurrences = array(
			$this->make_occurrence( 'a', '2026-02-27 09:00:00', '2026-03-02 17:00:00' ),
		);

		$by_day = EventFeedProvider::group_by_day( $occurrences, '2026-03-01 00:00:00', '2026-03-31 23:59:59' );

		$this->assertSame( array( '2026-03-01', '2026-03-02' ), array_keys( $by_day ) );

		// Clipped days still carry the DTO's true first/last-day markers.
		$this->assertFalse( $by_day['2026-03-01'][0]['is_first_day'] );
		$this->assertTrue( $by_day['2026-03-02'][0]['is_last_day'] );
	}

	/**
	 * Occurrences on the same day are sorted by start time.
	 */
	public function test_same_day_occurrences_sorted_by_start_time() {
		$occurrences = array(
			$this->make_occurrence( 'late', '2026-03-10 18:00:00', '2026-03-10 19:00:00' ),
			$this->make_occurrence( 'early', '2026-03-10 09:00:00', '2026-03-10 10:00:00' ),
		);

		$by_day = EventFeedProvider::group_by_day( $occurrences, '2026-03-01 00:00:00', '2026-03-31 23:59:59' );

		$this->assertSame( array( 'early', 'late' ), array_column( $by_day['2026-03-10'], 'uid' ) );
	}

	/**
	 * An occurrence with no end falls back to a single-day bucket at start.
	 */
	public function test_occurrence_with_no_end_defaults_to_start_day() {
		$occurrence = $this->make_occurrence( 'a', '2026-03-10 09:00:00', '' );

		$by_day = EventFeedProvider::group_by_day( array( $occurrence ), '2026-03-01 00:00:00', '2026-03-31 23:59:59' );

		$this->assertSame( array( '2026-03-10' ), array_keys( $by_day ) );
	}
}
