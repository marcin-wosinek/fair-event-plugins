<?php
/**
 * RecurrenceService unit tests
 *
 * Covers generate_occurrences() behaviour (no DB), the anchor-date matching
 * logic that reconcile_occurrences() depends on, and — against a small
 * in-memory event dates table — how reconciliation keeps excluded dates as
 * cancelled rows.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use PHPUnit\Framework\TestCase;
use FairEvents\Models\EventDates;
use FairEvents\Services\RecurrenceService;
use ReflectionProperty;

/**
 * In-memory stand-in for the event dates table: just the reads and writes
 * reconcile_occurrences() and classify_change() issue.
 */
class Recurrence_Test_WPDB {

	/**
	 * Table prefix, matching WordPress's default.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * ID of the most recently inserted row.
	 *
	 * @var int
	 */
	public $insert_id = 0;

	/**
	 * When true, every write reports a database error.
	 *
	 * @var bool
	 */
	public $fail_writes = false;

	/**
	 * Event date rows keyed by id.
	 *
	 * @var array<int, object>
	 */
	public $rows = array();

	/**
	 * Add an event date row.
	 *
	 * @param array $data Column values; unset columns get neutral defaults.
	 * @return int Row id.
	 */
	public function add_row( array $data ) {
		$id                = $data['id'] ?? ( empty( $this->rows ) ? 1 : max( array_keys( $this->rows ) ) + 1 );
		$this->rows[ $id ] = (object) array_merge(
			array(
				'event_id'        => null,
				'end_datetime'    => null,
				'all_day'         => 0,
				'occurrence_type' => 'generated',
				'master_id'       => null,
				'status'          => 'active',
			),
			$data,
			array( 'id' => $id )
		);
		return $id;
	}

	/**
	 * Stub of wpdb::prepare() — hands the query and its values to the reads.
	 *
	 * @param string $query   Query with placeholders.
	 * @param mixed  ...$args Values for the placeholders — [0] is the table.
	 * @return array{query: string, args: array}
	 */
	public function prepare( $query, ...$args ) {
		return array(
			'query' => $query,
			'args'  => $args,
		);
	}

	/**
	 * Stub of wpdb::get_row() for `WHERE id = %d` lookups.
	 *
	 * @param array $prepared Value returned by prepare().
	 * @return object|null
	 */
	public function get_row( $prepared ) {
		return $this->rows[ (int) $prepared['args'][1] ] ?? null;
	}

	/**
	 * Stub of wpdb::get_results() for `WHERE id = %d OR master_id = %d`.
	 *
	 * @param array $prepared Value returned by prepare().
	 * @return object[]
	 */
	public function get_results( $prepared ) {
		$master_id = (int) $prepared['args'][1];
		$rows      = array_filter(
			$this->rows,
			fn( $row ) => $row->id === $master_id || (int) $row->master_id === $master_id
		);
		usort( $rows, fn( $a, $b ) => strcmp( $a->start_datetime, $b->start_datetime ) );
		return $rows;
	}

	/**
	 * Stub of wpdb::get_var() — no ticket types or signups reference a date.
	 *
	 * @return int
	 */
	public function get_var() {
		return 0;
	}

	/**
	 * Stub of wpdb::update().
	 *
	 * @param string $table Table name.
	 * @param array  $data  Updated columns.
	 * @param array  $where Row selector.
	 * @return int|false Affected rows, or false on a simulated error.
	 */
	public function update( $table, $data, $where ) {
		if ( $this->fail_writes ) {
			return false;
		}
		foreach ( $data as $key => $value ) {
			$this->rows[ (int) $where['id'] ]->{$key} = $value;
		}
		return 1;
	}

	/**
	 * Stub of wpdb::insert().
	 *
	 * @param string $table Table name.
	 * @param array  $data  Inserted columns.
	 * @return int|false Inserted rows, or false on a simulated error.
	 */
	public function insert( $table, $data ) {
		if ( $this->fail_writes ) {
			return false;
		}
		unset( $data['id'] );
		$this->insert_id = $this->add_row( $data );
		return 1;
	}
}

/**
 * Tests for RecurrenceService
 */
class RecurrenceServiceTest extends TestCase {

	/**
	 * The shared fake $wpdb, restored after each test.
	 *
	 * @var object
	 */
	private $original_wpdb;

	/**
	 * In-memory event dates table for the reconciliation tests.
	 *
	 * @var Recurrence_Test_WPDB
	 */
	private $db;

	/**
	 * Swap in the in-memory table.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$this->original_wpdb = $GLOBALS['wpdb'];
		$this->db            = new Recurrence_Test_WPDB();
		$GLOBALS['wpdb']     = $this->db;
		$this->reset_master_cache();
	}

	/**
	 * Restore the shared fake.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->original_wpdb;
		$this->reset_master_cache();
	}

	/**
	 * Drop masters cached by EventDates from another test's table.
	 *
	 * @return void
	 */
	private function reset_master_cache() {
		( new ReflectionProperty( EventDates::class, 'master_cache' ) )->setValue( null, array() );
	}

	/**
	 * Seed a weekly standalone series starting 2035-03-01 10:00.
	 *
	 * @param array<string, string> $children Child status keyed by date (Y-m-d).
	 * @return array<string, int> Child row ids keyed by date; the master is id 1.
	 */
	private function seed_series( array $children ) {
		$this->db->add_row(
			array(
				'id'                => 1,
				'start_datetime'    => '2035-03-01 10:00:00',
				'end_datetime'      => '2035-03-01 12:00:00',
				'occurrence_type'   => 'master',
				'recurrence_anchor' => '2035-03-01',
			)
		);

		$ids = array();
		foreach ( $children as $date => $status ) {
			$ids[ $date ] = $this->db->add_row(
				array(
					'start_datetime'    => $date . ' 10:00:00',
					'end_datetime'      => $date . ' 12:00:00',
					'master_id'         => 1,
					'recurrence_anchor' => $date,
					'status'            => $status,
				)
			);
		}
		return $ids;
	}

	/**
	 * The generated children (everything after the master) of a rule.
	 *
	 * @param string $rrule RRULE string.
	 * @return array Occurrences with 'start' and 'end' keys.
	 */
	private function generated( $rrule ) {
		return array_slice(
			RecurrenceService::generate_occurrences( '2035-03-01 10:00:00', '2035-03-01 12:00:00', $rrule ),
			1
		);
	}

	/**
	 * Status of every child row, keyed by anchor date.
	 *
	 * @return array<string, string>
	 */
	private function child_statuses() {
		$statuses = array();
		foreach ( $this->db->rows as $row ) {
			if ( 1 === (int) $row->master_id ) {
				$statuses[ $row->recurrence_anchor ] = $row->status;
			}
		}
		ksort( $statuses );
		return $statuses;
	}

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

	// -----------------------------------------------------------------------
	// Excluded dates — the schedule keeps its limit
	// -----------------------------------------------------------------------

	/**
	 * Excluding dates of a COUNT rule never pulls in a later date to make up
	 * the number: the last date is the one the full schedule ends on.
	 */
	public function test_excluded_dates_do_not_extend_a_count_limit() {
		$full     = RecurrenceService::generate_occurrences( '2035-03-01 10:00:00', '2035-03-01 12:00:00', 'FREQ=WEEKLY;COUNT=10' );
		$excluded = RecurrenceService::generate_occurrences(
			'2035-03-01 10:00:00',
			'2035-03-01 12:00:00',
			'FREQ=WEEKLY;COUNT=10',
			null,
			array( '2035-03-08', '2035-03-22' )
		);

		$this->assertCount( 10, $full );
		$this->assertCount( 8, $excluded );
		$this->assertSame( '2035-05-03T10:00:00', $full[9]['start'] );
		$this->assertSame( $full[9]['start'], $excluded[7]['start'] );
	}

	/**
	 * Excluding dates of an UNTIL rule leaves the end date where it is.
	 */
	public function test_excluded_dates_do_not_extend_an_until_limit() {
		$excluded = RecurrenceService::generate_occurrences(
			'2035-03-01 10:00:00',
			'2035-03-01 12:00:00',
			'FREQ=WEEKLY;UNTIL=20350322',
			null,
			array( '2035-03-15' )
		);

		$starts = array_map( fn( $o ) => substr( $o['start'], 0, 10 ), $excluded );
		$this->assertSame( array( '2035-03-01', '2035-03-08', '2035-03-22' ), $starts );
	}

	// -----------------------------------------------------------------------
	// reconcile_occurrences — excluded dates stay as cancelled rows
	// -----------------------------------------------------------------------

	/**
	 * A new series saved with an excluded date materializes that date as a
	 * cancelled row, so it shows up (and can be restored) when reopened.
	 */
	public function test_reconcile_inserts_excluded_dates_as_cancelled_rows() {
		$this->seed_series( array() );

		$active = RecurrenceService::reconcile_occurrences(
			1,
			$this->generated( 'FREQ=WEEKLY;COUNT=4' ),
			false,
			array( 'event_id' => null ),
			array( '2035-03-15' )
		);

		$this->assertSame( 2, $active );
		$this->assertSame(
			array(
				'2035-03-08' => 'active',
				'2035-03-15' => 'cancelled',
				'2035-03-22' => 'active',
			),
			$this->child_statuses()
		);
	}

	/**
	 * Excluding a date that already has a row cancels that row in place,
	 * and saving the same selection again changes nothing.
	 */
	public function test_reconcile_cancels_existing_rows_in_place_and_is_repeatable() {
		$ids = $this->seed_series(
			array(
				'2035-03-08' => 'active',
				'2035-03-15' => 'active',
			)
		);

		for ( $run = 0; $run < 2; $run++ ) {
			RecurrenceService::reconcile_occurrences(
				1,
				$this->generated( 'FREQ=WEEKLY;COUNT=3' ),
				false,
				array( 'event_id' => null ),
				array( '2035-03-08' )
			);

			$this->assertCount( 3, $this->db->rows );
			$this->assertSame( 'cancelled', $this->db->rows[ $ids['2035-03-08'] ]->status );
			$this->assertSame( 'active', $this->db->rows[ $ids['2035-03-15'] ]->status );
		}
	}

	/**
	 * An empty exclusion list restores a cancelled date on its original row.
	 */
	public function test_reconcile_restores_dates_left_out_of_the_exclusion_list() {
		$ids = $this->seed_series(
			array(
				'2035-03-08' => 'cancelled',
				'2035-03-15' => 'cancelled',
			)
		);

		$active = RecurrenceService::reconcile_occurrences(
			1,
			$this->generated( 'FREQ=WEEKLY;COUNT=3' ),
			false,
			array( 'event_id' => null ),
			array( '2035-03-15' )
		);

		$this->assertSame( 1, $active );
		$this->assertSame( 'active', $this->db->rows[ $ids['2035-03-08'] ]->status );
		$this->assertSame( 'cancelled', $this->db->rows[ $ids['2035-03-15'] ]->status );

		RecurrenceService::reconcile_occurrences( 1, $this->generated( 'FREQ=WEEKLY;COUNT=3' ), false, array( 'event_id' => null ), array() );

		$this->assertSame( 'active', $this->db->rows[ $ids['2035-03-15'] ]->status );
		$this->assertCount( 3, $this->db->rows );
	}

	/**
	 * Callers that pass no exclusion list keep the old behaviour: every date
	 * the rule covers comes back active.
	 */
	public function test_reconcile_without_an_exclusion_list_restores_every_scheduled_date() {
		$ids = $this->seed_series( array( '2035-03-08' => 'cancelled' ) );

		$active = RecurrenceService::reconcile_occurrences(
			1,
			$this->generated( 'FREQ=WEEKLY;COUNT=3' ),
			false,
			array( 'event_id' => null )
		);

		$this->assertSame( 2, $active );
		$this->assertSame( 'active', $this->db->rows[ $ids['2035-03-08'] ]->status );
	}

	/**
	 * A row dropped by a shorter rule is still soft-cancelled, alongside the
	 * excluded dates of the new schedule.
	 */
	public function test_reconcile_still_soft_cancels_rows_the_rule_no_longer_covers() {
		$ids = $this->seed_series(
			array(
				'2035-03-08' => 'active',
				'2035-03-15' => 'active',
				'2035-03-22' => 'active',
			)
		);

		RecurrenceService::reconcile_occurrences(
			1,
			$this->generated( 'FREQ=WEEKLY;COUNT=3' ),
			false,
			array( 'event_id' => null ),
			array( '2035-03-08' )
		);

		$this->assertSame(
			array(
				'2035-03-08' => 'cancelled',
				'2035-03-15' => 'active',
				'2035-03-22' => 'cancelled',
			),
			$this->child_statuses()
		);
		$this->assertSame( $ids['2035-03-22'], array_key_last( $this->db->rows ) );
	}

	/**
	 * A failed write is reported instead of being counted as a saved date.
	 */
	public function test_reconcile_reports_a_failed_write() {
		$this->seed_series( array() );
		$this->db->fail_writes = true;

		$this->assertFalse(
			RecurrenceService::reconcile_occurrences(
				1,
				$this->generated( 'FREQ=WEEKLY;COUNT=3' ),
				false,
				array( 'event_id' => null ),
				array( '2035-03-08' )
			)
		);
	}

	// -----------------------------------------------------------------------
	// classify_change — compares against the active schedule
	// -----------------------------------------------------------------------

	/**
	 * Against the active dates of the new schedule: a newly excluded date is
	 * removed, a restored one is added, and a date that was already cancelled
	 * and stays so is no change at all.
	 */
	public function test_classify_change_reads_cancelled_rows_as_absent() {
		$ids = $this->seed_series(
			array(
				'2035-03-08' => 'active',
				'2035-03-15' => 'cancelled',
				'2035-03-22' => 'cancelled',
				'2035-03-29' => 'active',
			)
		);

		// Weekly COUNT=5 with 03-08 newly excluded, 03-15 restored and 03-22
		// still excluded.
		$active = array_slice(
			RecurrenceService::generate_occurrences(
				'2035-03-01 10:00:00',
				'2035-03-01 12:00:00',
				'FREQ=WEEKLY;COUNT=5',
				null,
				array( '2035-03-08', '2035-03-22' )
			),
			1
		);

		$impact = RecurrenceService::classify_change( 1, $active );

		$this->assertSame( array( $ids['2035-03-08'] ), array_column( $impact['removed'], 'id' ) );
		$this->assertSame( array( '2035-03-15T10:00:00' ), array_column( $impact['added'], 'start_datetime' ) );
		$this->assertSame( array( $ids['2035-03-29'] ), array_column( $impact['unchanged'], 'id' ) );
		$this->assertSame( array(), $impact['shifted'] );
	}
}
