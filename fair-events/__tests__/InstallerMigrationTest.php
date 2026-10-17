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
	 * Whether the timing marker column exists.
	 *
	 * @var bool
	 */
	public $has_marker_column = true;

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
		return $this->has_marker_column ? array( (object) array( 'Field' => $prepared['args'][1] ) ) : array();
	}

	/**
	 * Run one backfill batch.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return int|false Converted rows.
	 */
	public function query( $prepared ) {
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
	}

	/**
	 * The 3.45.0 backfill converts unmarked rows in batches until none is
	 * left, marking each row in the same statement.
	 *
	 * @return void
	 */
	public function test_3_45_0_backfill_runs_batches_until_done() {
		$wpdb                = new Installer_Timing_WPDB();
		$wpdb->batch_results = array( 500, 12, 0 );
		$GLOBALS['wpdb']     = $wpdb;

		$method = new ReflectionMethod( Installer::class, 'migrate_to_3_45_0' );

		$this->assertTrue( $method->invoke( null ) );
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

		$no_column                    = new Installer_Timing_WPDB();
		$no_column->has_marker_column = false;
		$GLOBALS['wpdb']              = $no_column;
		$this->assertFalse( $method->invoke( null ) );
		$this->assertCount( 0, $no_column->batches );
	}
}
