<?php
/**
 * Installer migration tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests;

// This focused migration test needs a minimal wpdb recorder in the same file
// and swaps the WordPress database global for the duration of the test.
// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use FairEvents\Database\Installer;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

/**
 * Minimal query recorder for the one-time warning repair.
 */
class Installer_Migration_WPDB {
	/**
	 * WordPress table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Executed prepared query.
	 *
	 * @var array|null
	 */
	public $executed = null;

	/**
	 * Capture a prepared query.
	 *
	 * @param string $query Query template.
	 * @param mixed  ...$args Query arguments.
	 * @return array Prepared query capture.
	 */
	public function prepare( $query, ...$args ) {
		return array(
			'query' => $query,
			'args'  => $args,
		);
	}

	/**
	 * Record an executed query.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return int Affected rows.
	 */
	public function query( $prepared ) {
		$this->executed = $prepared;
		return $this->query_result;
	}

	/**
	 * Result returned by query(); false simulates a database error.
	 *
	 * @var int|false
	 */
	public $query_result = 1;
}

/**
 * Scripted database double for the 3.45.0 timing backfill.
 */
class Installer_Timing_WPDB {
	/**
	 * WordPress table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Existing legacy timing columns: the datetimes and the marker.
	 *
	 * @var string[]
	 */
	public $columns = array( 'start_datetime', 'end_datetime', 'timing_migrated' );

	/**
	 * Result of each ALTER TABLE; false simulates a database error.
	 *
	 * @var bool
	 */
	public $alter_result = true;

	/**
	 * Executed ALTER TABLE statements.
	 *
	 * @var array<int, array>
	 */
	public $alters = array();

	/**
	 * Executed statements marking rows that already have a start date.
	 *
	 * @var array<int, array>
	 */
	public $marks = array();

	/**
	 * Results of successive backfill batches; false simulates a database error.
	 *
	 * @var array<int, int|false>
	 */
	public $batch_results = array();

	/**
	 * Rows left unconverted after the batches.
	 *
	 * @var string|null
	 */
	public $remaining = '0';

	/**
	 * Executed batch queries.
	 *
	 * @var array<int, array>
	 */
	public $batches = array();

	/**
	 * Capture a prepared query.
	 *
	 * @param string $query Query template.
	 * @param mixed  ...$args Query arguments.
	 * @return array Prepared query capture.
	 */
	public function prepare( $query, ...$args ) {
		return array(
			'query' => $query,
			'args'  => $args,
		);
	}

	/**
	 * Escape a LIKE pattern (no-op double).
	 *
	 * @param string $text Text.
	 * @return string Text.
	 */
	public function esc_like( $text ) {
		return $text;
	}

	/**
	 * Answer the column check.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return array Matching columns.
	 */
	public function get_results( $prepared ) {
		return in_array( $prepared['args'][1], $this->columns, true ) ? array( (object) array( 'Field' => $prepared['args'][1] ) ) : array();
	}

	/**
	 * Run an ALTER TABLE, a marking statement or one backfill batch.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return int|bool Affected rows, or the ALTER result.
	 */
	public function query( $prepared ) {
		if ( 0 === strpos( $prepared['query'], 'ALTER TABLE' ) ) {
			$this->alters[] = $prepared;
			if ( $this->alter_result && false !== strpos( $prepared['query'], 'ADD COLUMN timing_migrated' ) ) {
				$this->columns[] = 'timing_migrated';
			}
			return $this->alter_result;
		}

		if ( false === strpos( $prepared['query'], 'LIMIT' ) ) {
			$this->marks[] = $prepared;
			return 0;
		}

		$this->batches[] = $prepared;
		return array_shift( $this->batch_results ) ?? 0;
	}

	/**
	 * Count unconverted rows.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return string|null Count.
	 */
	public function get_var( $prepared ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- signature matches wpdb.
		return $this->remaining;
	}
}

/**
 * In-memory database double for the 3.46.0 override detection.
 */
class Installer_Overrides_WPDB {
	/**
	 * WordPress table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Event date rows keyed by id.
	 *
	 * @var array<int, object>
	 */
	public $rows = array();

	/**
	 * Whether the marker columns exist.
	 *
	 * @var bool
	 */
	public $has_marker_columns = true;

	/**
	 * Row ids requested by each batch query, in order.
	 *
	 * @var array<int, int>
	 */
	public $batch_after = array();

	/**
	 * Capture a prepared query.
	 *
	 * @param string $query   Query template.
	 * @param mixed  ...$args Query arguments.
	 * @return array Prepared query capture.
	 */
	public function prepare( $query, ...$args ) {
		if ( isset( $args[0] ) && is_array( $args[0] ) ) {
			$args = $args[0];
		}
		return array(
			'query' => $query,
			'args'  => $args,
		);
	}

	/**
	 * Escape a LIKE pattern (no-op double).
	 *
	 * @param string $text Text.
	 * @return string Text.
	 */
	public function esc_like( $text ) {
		return $text;
	}

	/**
	 * Answer the column check, a batch of generated rows, or masters by id.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return array Rows.
	 */
	public function get_results( $prepared ) {
		if ( 0 === strpos( $prepared['query'], 'SHOW COLUMNS' ) ) {
			return $this->has_marker_columns ? array( (object) array( 'Field' => $prepared['args'][1] ) ) : array();
		}

		if ( false !== strpos( $prepared['query'], 'id IN' ) ) {
			$ids = array_slice( $prepared['args'], 1 );
			return array_values( array_intersect_key( $this->rows, array_flip( $ids ) ) );
		}

		list( , $after, $limit ) = $prepared['args'];
		$this->batch_after[]     = $after;
		$rows                    = array_filter(
			$this->rows,
			static function ( $row ) use ( $after ) {
				return 'generated' === $row->occurrence_type && $row->id > $after;
			}
		);
		ksort( $rows );
		return array_slice( array_values( $rows ), 0, $limit );
	}

	/**
	 * Update a row.
	 *
	 * @param string $table Table.
	 * @param array  $data  Columns.
	 * @param array  $where Row selector.
	 * @return int Affected rows.
	 */
	public function update( $table, $data, $where ) {
		foreach ( $data as $key => $value ) {
			$this->rows[ $where['id'] ]->$key = $value;
		}
		return 1;
	}
}

/**
 * Covers the 3.33.0 historical warning repair.
 */
class InstallerMigrationTest extends TestCase {

	/**
	 * Restore the shared database double after each test.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = new \Fair_Test_WPDB();
		parent::tearDown();
	}

	/**
	 * Upgrade clears only rows carrying the unreliable flag.
	 *
	 * @return void
	 */
	public function test_3_33_0_migration_clears_existing_over_capacity_flags() {
		$wpdb            = new Installer_Migration_WPDB();
		$GLOBALS['wpdb'] = $wpdb;

		$method = new ReflectionMethod( Installer::class, 'migrate_to_3_33_0' );
		$method->invoke( null );

		$this->assertStringContainsString( 'UPDATE %i SET over_capacity = %d WHERE over_capacity = %d', $wpdb->executed['query'] );
		$this->assertSame( array( 'wp_fair_events_signups', 0, 1 ), $wpdb->executed['args'] );
	}

	/**
	 * The 3.44.0 cleanup drops the add-on collaborator table and nothing else.
	 *
	 * @return void
	 */
	public function test_3_44_0_migration_drops_only_the_addon_collaborator_table() {
		$wpdb               = new Installer_Migration_WPDB();
		$wpdb->query_result = 0;
		$GLOBALS['wpdb']    = $wpdb;

		$method = new ReflectionMethod( Installer::class, 'migrate_to_3_44_0' );

		$this->assertTrue( $method->invoke( null ) );
		$this->assertSame( 'DROP TABLE IF EXISTS %i', $wpdb->executed['query'] );
		$this->assertSame( array( 'wp_fair_events_ticket_option_collaborators' ), $wpdb->executed['args'] );
	}

	/**
	 * A failed drop is reported, so the upgrade can retry it.
	 *
	 * @return void
	 */
	public function test_3_44_0_migration_reports_a_failed_drop() {
		$wpdb               = new Installer_Migration_WPDB();
		$wpdb->query_result = false;
		$GLOBALS['wpdb']    = $wpdb;

		$method = new ReflectionMethod( Installer::class, 'migrate_to_3_44_0' );

		$this->assertFalse( $method->invoke( null ) );
	}

	/**
	 * The stored version stays below the earliest failed cleanup.
	 *
	 * @return void
	 */
	public function test_recorded_version_stops_below_a_failed_cleanup() {
		$method = new ReflectionMethod( Installer::class, 'version_to_record' );

		$this->assertSame( \FairEvents\Database\Schema::DB_VERSION, $method->invoke( null, true, true ) );
		$this->assertSame( '3.43.0', $method->invoke( null, true, false ) );
		$this->assertSame( '3.35.0', $method->invoke( null, false, true ) );
		$this->assertSame( '3.35.0', $method->invoke( null, false, false ) );
		$this->assertTrue( version_compare( '3.43.0', '3.44.0', '<' ) );
		$this->assertSame( '3.44.0', $method->invoke( null, true, true, false ) );
		$this->assertSame( '3.43.0', $method->invoke( null, true, false, false ) );
		$this->assertSame( '3.46.0', $method->invoke( null, true, true, true, true, false ) );
		$this->assertSame( '3.45.0', $method->invoke( null, true, true, true, false, false ) );
	}

	/**
	 * The 3.45.0 backfill converts unmarked rows in batches until none is
	 * left, marking each row in the same statement. Rows that already have
	 * a start date (written by code that no longer fills the legacy
	 * columns) are only marked, never converted.
	 *
	 * @return void
	 */
	public function test_3_45_0_backfill_runs_batches_until_done() {
		$wpdb                = new Installer_Timing_WPDB();
		$wpdb->batch_results = array( 500, 12, 0 );
		$GLOBALS['wpdb']     = $wpdb;

		$method = new ReflectionMethod( Installer::class, 'migrate_to_3_45_0' );

		$this->assertTrue( $method->invoke( null ) );
		$this->assertCount( 1, $wpdb->marks );
		$this->assertSame( 'UPDATE %i SET timing_migrated = 1 WHERE timing_migrated = 0 AND start_date IS NOT NULL', $wpdb->marks[0]['query'] );
		$this->assertCount( 3, $wpdb->batches );
		$query = $wpdb->batches[0]['query'];
		$this->assertStringContainsString( 'WHERE timing_migrated = 0', $query );
		$this->assertStringContainsString( 'timing_migrated = 1', $query );
		$this->assertStringContainsString( 'start_time = CASE WHEN all_day = 1 OR start_datetime IS NULL THEN NULL ELSE TIME( start_datetime ) END', $query );
		$this->assertStringContainsString( 'WHEN end_datetime IS NULL THEN DATE( start_datetime )', $query );
		$this->assertSame( array( 'wp_fair_event_dates', Installer::TIMING_BACKFILL_BATCH ), $wpdb->batches[0]['args'] );
	}

	/**
	 * An interrupted or failed backfill is reported, so the version stays
	 * below 3.45.0 and the next upgrade resumes it.
	 *
	 * @return void
	 */
	public function test_3_45_0_backfill_reports_incomplete_runs() {
		$method = new ReflectionMethod( Installer::class, 'migrate_to_3_45_0' );

		$failed                = new Installer_Timing_WPDB();
		$failed->batch_results = array( 500, false );
		$GLOBALS['wpdb']       = $failed;
		$this->assertFalse( $method->invoke( null ) );

		$left_over            = new Installer_Timing_WPDB();
		$left_over->remaining = '3';
		$GLOBALS['wpdb']      = $left_over;
		$this->assertFalse( $method->invoke( null ) );

		$failed_marker               = new Installer_Timing_WPDB();
		$failed_marker->columns      = array( 'start_datetime', 'end_datetime' );
		$failed_marker->alter_result = false;
		$GLOBALS['wpdb']             = $failed_marker;
		$this->assertFalse( $method->invoke( null ) );
		$this->assertCount( 0, $failed_marker->batches );
	}

	/**
	 * A site upgrading past 3.45.0 at once no longer gets the marker column
	 * from dbDelta, so the backfill adds it; a table without the legacy
	 * columns has nothing to convert.
	 *
	 * @return void
	 */
	public function test_3_45_0_backfill_adds_its_marker_or_skips_without_legacy_columns() {
		$method = new ReflectionMethod( Installer::class, 'migrate_to_3_45_0' );

		$no_marker          = new Installer_Timing_WPDB();
		$no_marker->columns = array( 'start_datetime', 'end_datetime' );
		$GLOBALS['wpdb']    = $no_marker;
		$this->assertTrue( $method->invoke( null ) );
		$this->assertStringContainsString( 'ADD COLUMN timing_migrated BOOLEAN NOT NULL DEFAULT 0', $no_marker->alters[0]['query'] );
		$this->assertCount( 1, $no_marker->batches );

		$no_legacy          = new Installer_Timing_WPDB();
		$no_legacy->columns = array();
		$GLOBALS['wpdb']    = $no_legacy;
		$this->assertTrue( $method->invoke( null ) );
		$this->assertCount( 0, $no_legacy->batches );
		$this->assertCount( 0, $no_legacy->alters );
	}

	/**
	 * 3.47.0 drops the legacy columns, with their indexes, once the
	 * backfill (rerun first) reports every row converted.
	 *
	 * @return void
	 */
	public function test_3_47_0_drops_legacy_columns_after_backfill() {
		$wpdb            = new Installer_Timing_WPDB();
		$GLOBALS['wpdb'] = $wpdb;

		$method = new ReflectionMethod( Installer::class, 'migrate_to_3_47_0' );

		$this->assertTrue( $method->invoke( null ) );
		$this->assertCount( 1, $wpdb->batches );
		$this->assertCount( 1, $wpdb->alters );
		$this->assertSame( 'ALTER TABLE %i DROP COLUMN start_datetime, DROP COLUMN end_datetime, DROP COLUMN timing_migrated', $wpdb->alters[0]['query'] );
		$this->assertSame( array( 'wp_fair_event_dates' ), $wpdb->alters[0]['args'] );
	}

	/**
	 * 3.47.0 keeps the legacy columns while rows are unconverted or the
	 * drop fails, and has nothing to do once they are gone.
	 *
	 * @return void
	 */
	public function test_3_47_0_keeps_columns_until_safe() {
		$method = new ReflectionMethod( Installer::class, 'migrate_to_3_47_0' );

		$left_over            = new Installer_Timing_WPDB();
		$left_over->remaining = '2';
		$GLOBALS['wpdb']      = $left_over;
		$this->assertFalse( $method->invoke( null ) );
		$this->assertCount( 0, $left_over->alters );

		$failed_drop               = new Installer_Timing_WPDB();
		$failed_drop->alter_result = false;
		$GLOBALS['wpdb']           = $failed_drop;
		$this->assertFalse( $method->invoke( null ) );

		$retired          = new Installer_Timing_WPDB();
		$retired->columns = array();
		$GLOBALS['wpdb']  = $retired;
		$this->assertTrue( $method->invoke( null ) );
		$this->assertCount( 0, $retired->alters );
	}

	/**
	 * Canonical row for the override detection double.
	 *
	 * @param int    $id    Row id.
	 * @param string $date  Start and end date.
	 * @param array  $extra Other columns.
	 * @return object Row.
	 */
	private function override_row( $id, $date, array $extra = array() ) {
		return (object) array_merge(
			array(
				'id'                => $id,
				'occurrence_type'   => 'generated',
				'master_id'         => 1,
				'recurrence_anchor' => $date,
				'start_date'        => $date,
				'end_date'          => $date,
				'start_time'        => '18:00:00',
				'end_time'          => '20:00:00',
				'all_day'           => 0,
				'dates_override'    => 0,
				'times_override'    => 0,
			),
			$extra
		);
	}

	/**
	 * The 3.46.0 detection marks each group that differs from what the
	 * series generates for the occurrence's anchor, and nothing else.
	 *
	 * @return void
	 */
	public function test_3_46_0_marks_deviating_occurrences() {
		$wpdb            = new Installer_Overrides_WPDB();
		$wpdb->rows      = array(
			1 => $this->override_row(
				1,
				'2026-11-02',
				array(
					'occurrence_type' => 'master',
					'master_id'       => null,
				)
			),
			2 => $this->override_row( 2, '2026-11-09' ),
			3 => $this->override_row( 3, '2026-11-16', array( 'end_time' => null ) ),
			4 => $this->override_row(
				4,
				'2026-11-23',
				array(
					'start_date' => '2026-11-24',
					'end_date'   => '2026-11-24',
				)
			),
			5 => $this->override_row( 5, '2026-11-30', array( 'all_day' => 1 ) ),
		);
		$GLOBALS['wpdb'] = $wpdb;

		$method = new ReflectionMethod( Installer::class, 'migrate_to_3_46_0' );
		$this->assertTrue( $method->invoke( null ) );

		$markers = array();
		foreach ( array( 2, 3, 4, 5 ) as $id ) {
			$markers[ $id ] = array( (int) $wpdb->rows[ $id ]->dates_override, (int) $wpdb->rows[ $id ]->times_override );
		}
		$this->assertSame(
			array(
				2 => array( 0, 0 ),
				3 => array( 0, 1 ),
				4 => array( 1, 0 ),
				5 => array( 0, 1 ),
			),
			$markers
		);

		// A rerun only sets markers, so a reset made since stays reset.
		$this->assertTrue( $method->invoke( null ) );
		$this->assertSame( 1, (int) $wpdb->rows[3]->times_override );
	}

	/**
	 * Without the marker columns the detection reports failure, so the
	 * version stays below 3.46.0; that recorded version follows each step.
	 *
	 * @return void
	 */
	public function test_3_46_0_reports_missing_columns() {
		$wpdb                     = new Installer_Overrides_WPDB();
		$wpdb->has_marker_columns = false;
		$GLOBALS['wpdb']          = $wpdb;

		$this->assertFalse( ( new ReflectionMethod( Installer::class, 'migrate_to_3_46_0' ) )->invoke( null ) );

		$record = new ReflectionMethod( Installer::class, 'version_to_record' );
		$this->assertSame( '3.45.0', $record->invoke( null, true, true, true, false ) );
		$this->assertSame( '3.44.0', $record->invoke( null, true, true, false, false ) );
	}
}
