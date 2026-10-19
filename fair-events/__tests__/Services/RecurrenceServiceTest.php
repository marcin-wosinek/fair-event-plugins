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
use FairEvents\Helpers\EventTiming;
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
		usort( $rows, fn( $a, $b ) => strcmp( $a->start_date . ' ' . $a->start_time, $b->start_date . ' ' . $b->start_time ) );
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
	 * Canonical timing.
	 *
	 * @param string      $start_date Start date.
	 * @param string|null $start_time Start time.
	 * @param string|null $end_time   End time.
	 * @param string|null $end_date   End date; the start date when null.
	 * @param bool        $all_day    All-day flag.
	 * @return array Timing.
	 */
	private function timing( $start_date, $start_time = '10:00:00', $end_time = '12:00:00', $end_date = null, $all_day = false ) {
		return array(
			'start_date' => $start_date,
			'end_date'   => $end_date ?? $start_date,
			'start_time' => $start_time,
			'end_time'   => $end_time,
			'all_day'    => $all_day,
		);
	}

	/**
	 * Canonical columns of a seeded row.
	 *
	 * @param array $timing Timing.
	 * @return array Column values.
	 */
	private function columns( array $timing ) {
		return array_merge(
			$timing,
			array(
				'all_day' => $timing['all_day'] ? 1 : 0,
			)
		);
	}

	/**
	 * Seed a weekly standalone series starting 2035-03-01 10:00–12:00.
	 *
	 * @param array<string, string> $children  Child status keyed by date (Y-m-d).
	 * @param array<string, array>  $overrides Child timing columns keyed by date, merged over the inherited ones.
	 * @return array<string, int> Child row ids keyed by date; the master is id 1.
	 */
	private function seed_series( array $children, array $overrides = array() ) {
		$this->db->add_row(
			array_merge(
				$this->columns( $this->timing( '2035-03-01' ) ),
				array(
					'id'                => 1,
					'occurrence_type'   => 'master',
					'recurrence_anchor' => '2035-03-01',
				)
			)
		);

		$ids = array();
		foreach ( $children as $date => $status ) {
			$ids[ $date ] = $this->db->add_row(
				array_merge(
					$this->columns( $this->timing( $date ) ),
					$overrides[ $date ] ?? array(),
					array(
						'master_id'         => 1,
						'recurrence_anchor' => $date,
						'status'            => $status,
					)
				)
			);
		}
		return $ids;
	}

	/**
	 * The generated children (everything after the master) of a rule.
	 *
	 * @param string     $rrule  RRULE string.
	 * @param array|null $timing Series timing; 2035-03-01 10:00–12:00 by default.
	 * @return array[] Canonical timings.
	 */
	private function generated( $rrule, $timing = null ) {
		return array_slice(
			RecurrenceService::generate_occurrences( $timing ?? $this->timing( '2035-03-01' ), $rrule ),
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

	/**
	 * Canonical timing stored on a row.
	 *
	 * @param int $id Row id.
	 * @return array Timing.
	 */
	private function stored_timing( $id ) {
		$row = $this->db->rows[ $id ];
		return array(
			'start_date' => $row->start_date,
			'end_date'   => $row->end_date,
			'start_time' => $row->start_time,
			'end_time'   => $row->end_time,
			'all_day'    => (bool) $row->all_day,
		);
	}

	// -----------------------------------------------------------------------
	// generate_occurrences — basic invariants
	// -----------------------------------------------------------------------

	/**
	 * Weekly COUNT=3 produces exactly 3 occurrences on consecutive weeks.
	 */
	public function test_generate_weekly_count() {
		$occurrences = RecurrenceService::generate_occurrences( $this->timing( '2035-03-01' ), 'FREQ=WEEKLY;COUNT=3' );

		$this->assertSame(
			array(
				$this->timing( '2035-03-01' ),
				$this->timing( '2035-03-08' ),
				$this->timing( '2035-03-15' ),
			),
			$occurrences
		);
	}

	/**
	 * Every combination of missing times stays missing on every occurrence;
	 * genuine midnight stays midnight.
	 */
	public function test_generate_keeps_each_time_optional() {
		$combinations = array(
			array( '18:00:00', '20:00:00' ),
			array( '18:00:00', null ),
			array( null, '20:00:00' ),
			array( null, null ),
			array( '00:00:00', null ),
		);

		foreach ( $combinations as list( $start_time, $end_time ) ) {
			$occurrences = RecurrenceService::generate_occurrences( $this->timing( '2035-03-01', $start_time, $end_time ), 'FREQ=WEEKLY;COUNT=2' );

			$this->assertSame( $this->timing( '2035-03-08', $start_time, $end_time ), $occurrences[1] );
		}
	}

	/**
	 * A multi-day event keeps its calendar-day span, overnight or all-day,
	 * and an all-day series gets no times.
	 */
	public function test_generate_keeps_the_calendar_day_span() {
		$overnight = RecurrenceService::generate_occurrences( $this->timing( '2035-03-02', '22:00:00', '02:00:00', '2035-03-03' ), 'FREQ=WEEKLY;COUNT=2' );
		$this->assertSame( $this->timing( '2035-03-09', '22:00:00', '02:00:00', '2035-03-10' ), $overnight[1] );

		$untimed = RecurrenceService::generate_occurrences( $this->timing( '2035-03-02', null, null, '2035-03-04' ), 'FREQ=MONTHLY;COUNT=2' );
		$this->assertSame( $this->timing( '2035-04-02', null, null, '2035-04-04' ), $untimed[1] );

		$all_day = RecurrenceService::generate_occurrences( $this->timing( '2035-03-30', null, null, '2035-04-01', true ), 'FREQ=DAILY;COUNT=2' );
		$this->assertSame( $this->timing( '2035-03-31', null, null, '2035-04-02', true ), $all_day[1] );
	}

	/**
	 * Dates are calendar dates: a weekly series across a DST change keeps
	 * its wall-clock times.
	 */
	public function test_generate_ignores_daylight_saving_changes() {
		$occurrences = RecurrenceService::generate_occurrences( $this->timing( '2035-03-21', '18:00:00', '20:00:00' ), 'FREQ=WEEKLY;COUNT=3' );

		$this->assertSame( $this->timing( '2035-04-04', '18:00:00', '20:00:00' ), $occurrences[2] );
	}

	/**
	 * An UNTIL with a time compares against each date's start time, or the
	 * start of the day without one; a date-only UNTIL includes its day.
	 */
	public function test_generate_until_uses_the_start_time_when_there_is_one() {
		$timed   = RecurrenceService::generate_occurrences( $this->timing( '2035-03-01', '10:00:00', null ), 'FREQ=WEEKLY;UNTIL=20350315T090000' );
		$untimed = RecurrenceService::generate_occurrences( $this->timing( '2035-03-01', null, null ), 'FREQ=WEEKLY;UNTIL=20350315T090000' );
		$day     = RecurrenceService::generate_occurrences( $this->timing( '2035-03-01', '23:00:00', null ), 'FREQ=WEEKLY;UNTIL=20350315' );

		$this->assertSame( array( '2035-03-01', '2035-03-08' ), array_column( $timed, 'start_date' ) );
		$this->assertSame( array( '2035-03-01', '2035-03-08', '2035-03-15' ), array_column( $untimed, 'start_date' ) );
		$this->assertSame( array( '2035-03-01', '2035-03-08', '2035-03-15' ), array_column( $day, 'start_date' ) );
	}

	/**
	 * An undated timing has no schedule.
	 */
	public function test_generate_needs_a_start_date() {
		$this->assertSame( array(), RecurrenceService::generate_occurrences( EventTiming::undated(), 'FREQ=WEEKLY;COUNT=3' ) );
	}

	/**
	 * Anchor dates are invariant under a time-of-day shift, which is what
	 * lets reconcile_occurrences() match existing rows after a shift.
	 */
	public function test_anchor_dates_unchanged_by_time_shift() {
		$before = RecurrenceService::generate_occurrences( $this->timing( '2035-03-01' ), 'FREQ=WEEKLY;COUNT=3' );
		$after  = RecurrenceService::generate_occurrences( $this->timing( '2035-03-01', '11:00:00', '13:00:00' ), 'FREQ=WEEKLY;COUNT=3' );

		$this->assertSame( array_column( $before, 'start_date' ), array_column( $after, 'start_date' ) );
	}

	/**
	 * Shortening COUNT from 4 to 2 removes the last 2 anchors.
	 */
	public function test_shorten_rrule_drops_tail_anchors() {
		$full  = array_column( RecurrenceService::generate_occurrences( $this->timing( '2035-03-01' ), 'FREQ=WEEKLY;COUNT=4' ), 'start_date' );
		$short = array_column( RecurrenceService::generate_occurrences( $this->timing( '2035-03-01' ), 'FREQ=WEEKLY;COUNT=2' ), 'start_date' );

		$this->assertSame( array_slice( $full, 0, 2 ), $short );
		$this->assertCount( 2, array_diff( $full, $short ) );
	}

	/**
	 * Exdates reduce the occurrence count but keep anchor dates consistent.
	 */
	public function test_exdate_skips_occurrence() {
		$occurrences = RecurrenceService::generate_occurrences( $this->timing( '2035-03-01' ), 'FREQ=WEEKLY;COUNT=3', null, array( '2035-03-08' ) );

		$this->assertSame( array( '2035-03-01', '2035-03-15' ), array_column( $occurrences, 'start_date' ) );
	}

	// -----------------------------------------------------------------------
	// build_manual_occurrences — pure, no DB
	// -----------------------------------------------------------------------

	/**
	 * Dates are sorted ascending regardless of input order, each taking the
	 * reference timing's span and times.
	 */
	public function test_build_manual_occurrences_sorts_and_applies_the_timing() {
		$occurrences = RecurrenceService::build_manual_occurrences(
			$this->timing( '2035-03-01', null, '12:00:00' ),
			array( '2035-03-15', '2035-03-01', '2035-03-08' )
		);

		$this->assertSame(
			array(
				$this->timing( '2035-03-01', null, '12:00:00' ),
				$this->timing( '2035-03-08', null, '12:00:00' ),
				$this->timing( '2035-03-15', null, '12:00:00' ),
			),
			$occurrences
		);
	}

	/**
	 * Duplicate dates are collapsed to a single occurrence.
	 */
	public function test_build_manual_occurrences_deduplicates() {
		$this->assertCount( 1, RecurrenceService::build_manual_occurrences( $this->timing( '2035-03-01' ), array( '2035-03-01', '2035-03-01' ) ) );
	}

	/**
	 * An empty date list produces no occurrences (caller falls back / no-ops).
	 */
	public function test_build_manual_occurrences_empty_list() {
		$this->assertSame( array(), RecurrenceService::build_manual_occurrences( $this->timing( '2035-03-01' ), array() ) );
	}

	// -----------------------------------------------------------------------
	// Excluded dates — the schedule keeps its limit
	// -----------------------------------------------------------------------

	/**
	 * Excluding dates of a COUNT rule never pulls in a later date to make up
	 * the number: the last date is the one the full schedule ends on.
	 */
	public function test_excluded_dates_do_not_extend_a_count_limit() {
		$full     = RecurrenceService::generate_occurrences( $this->timing( '2035-03-01' ), 'FREQ=WEEKLY;COUNT=10' );
		$excluded = RecurrenceService::generate_occurrences( $this->timing( '2035-03-01' ), 'FREQ=WEEKLY;COUNT=10', null, array( '2035-03-08', '2035-03-22' ) );

		$this->assertCount( 10, $full );
		$this->assertCount( 8, $excluded );
		$this->assertSame( '2035-05-03', $full[9]['start_date'] );
		$this->assertSame( $full[9], $excluded[7] );
	}

	/**
	 * Excluding dates of an UNTIL rule leaves the end date where it is.
	 */
	public function test_excluded_dates_do_not_extend_an_until_limit() {
		$excluded = RecurrenceService::generate_occurrences( $this->timing( '2035-03-01' ), 'FREQ=WEEKLY;UNTIL=20350322', null, array( '2035-03-15' ) );

		$this->assertSame( array( '2035-03-01', '2035-03-08', '2035-03-22' ), array_column( $excluded, 'start_date' ) );
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
			array( 'event_id' => null ),
			array( '2035-03-15' )
		);

		$this->assertSame( 1, $active );
		$this->assertSame( 'active', $this->db->rows[ $ids['2035-03-08'] ]->status );
		$this->assertSame( 'cancelled', $this->db->rows[ $ids['2035-03-15'] ]->status );

		RecurrenceService::reconcile_occurrences( 1, $this->generated( 'FREQ=WEEKLY;COUNT=3' ), array( 'event_id' => null ), array() );

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
				array( 'event_id' => null ),
				array( '2035-03-08' )
			)
		);
	}

	// -----------------------------------------------------------------------
	// reconcile_occurrences — timing overrides
	// -----------------------------------------------------------------------

	/**
	 * A series change rewrites only the timing groups an occurrence does not
	 * override: own times survive a new series time, own dates survive a new
	 * series span, and an inherited occurrence follows the series.
	 */
	public function test_reconcile_keeps_overridden_groups() {
		$ids = $this->seed_series(
			array(
				'2035-03-08' => 'active',
				'2035-03-15' => 'active',
				'2035-03-22' => 'active',
			),
			array(
				'2035-03-08' => array(
					'start_time'     => '15:00:00',
					'end_time'       => null,
					'times_override' => 1,
				),
				'2035-03-15' => array(
					'start_date'     => '2035-03-16',
					'end_date'       => '2035-03-16',
					'dates_override' => 1,
				),
			)
		);

		$series = $this->timing( '2035-03-01', null, '21:00:00' );
		RecurrenceService::reconcile_occurrences( 1, $this->generated( 'FREQ=WEEKLY;COUNT=4', $series ), array( 'event_id' => null ) );

		$this->assertSame( $this->timing( '2035-03-08', '15:00:00', null ), $this->stored_timing( $ids['2035-03-08'] ) );
		$this->assertSame( $this->timing( '2035-03-16', null, '21:00:00' ), $this->stored_timing( $ids['2035-03-15'] ) );
		$this->assertSame( $this->timing( '2035-03-22', null, '21:00:00' ), $this->stored_timing( $ids['2035-03-22'] ) );
		$this->assertSame( 1, (int) $this->db->rows[ $ids['2035-03-08'] ]->times_override );
		$this->assertSame( '2035-03-15', $this->db->rows[ $ids['2035-03-15'] ]->recurrence_anchor );
	}

	/**
	 * A time cleared on an occurrence stays cleared: the override keeps the
	 * null instead of inheriting the series time.
	 */
	public function test_reconcile_keeps_a_cleared_time() {
		$ids = $this->seed_series(
			array( '2035-03-08' => 'active' ),
			array(
				'2035-03-08' => array(
					'start_time'     => null,
					'end_time'       => null,
					'times_override' => 1,
				),
			)
		);

		RecurrenceService::reconcile_occurrences( 1, $this->generated( 'FREQ=WEEKLY;COUNT=2' ), array( 'event_id' => null ) );

		$this->assertSame( $this->timing( '2035-03-08', null, null ), $this->stored_timing( $ids['2035-03-08'] ) );
	}

	/**
	 * Overnight series times on an occurrence moved to a single day are a
	 * conflict; the same change is fine for inherited and cancelled dates.
	 */
	public function test_find_override_conflicts() {
		$ids = $this->seed_series(
			array(
				'2035-03-08' => 'active',
				'2035-03-15' => 'cancelled',
				'2035-03-22' => 'active',
			),
			array(
				'2035-03-08' => array( 'dates_override' => 1 ),
				'2035-03-15' => array( 'dates_override' => 1 ),
			)
		);

		$overnight = $this->generated( 'FREQ=WEEKLY;COUNT=4', $this->timing( '2035-03-01', '22:00:00', '02:00:00', '2035-03-02' ) );
		$this->assertSame(
			array(
				array(
					'id'         => $ids['2035-03-08'],
					'start_date' => '2035-03-08',
					'reason'     => 'end_time_before_start',
				),
			),
			RecurrenceService::find_override_conflicts( 1, $overnight )
		);

		$this->assertSame( array(), RecurrenceService::find_override_conflicts( 1, $this->generated( 'FREQ=WEEKLY;COUNT=4', $this->timing( '2035-03-01', '09:00:00', '11:00:00' ) ) ) );
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
			RecurrenceService::generate_occurrences( $this->timing( '2035-03-01' ), 'FREQ=WEEKLY;COUNT=5', null, array( '2035-03-08', '2035-03-22' ) ),
			1
		);

		$impact = RecurrenceService::classify_change( 1, $active );

		$this->assertSame( array( $ids['2035-03-08'] ), array_column( $impact['removed'], 'id' ) );
		$this->assertSame( array( '2035-03-15' ), array_column( $impact['added'], 'start_date' ) );
		$this->assertSame( array( '10:00:00' ), array_column( $impact['added'], 'start_time' ) );
		$this->assertSame( array( $ids['2035-03-29'] ), array_column( $impact['unchanged'], 'id' ) );
		$this->assertSame( array(), $impact['shifted'] );
	}

	/**
	 * A new series time shifts inherited dates only: a date with its own
	 * times is unchanged.
	 */
	public function test_classify_change_respects_overrides() {
		$ids = $this->seed_series(
			array(
				'2035-03-08' => 'active',
				'2035-03-15' => 'active',
			),
			array(
				'2035-03-08' => array(
					'start_time'     => '15:00:00',
					'times_override' => 1,
				),
			)
		);

		$impact = RecurrenceService::classify_change( 1, $this->generated( 'FREQ=WEEKLY;COUNT=3', $this->timing( '2035-03-01', null, '12:00:00' ) ) );

		$this->assertSame( array( $ids['2035-03-08'] ), array_column( $impact['unchanged'], 'id' ) );
		$this->assertSame( array( $ids['2035-03-15'] ), array_column( $impact['shifted'], 'id' ) );
		$this->assertSame( '2035-03-15', $impact['shifted'][0]['new_start_date'] );
		$this->assertNull( $impact['shifted'][0]['new_start_time'] );
	}
}
