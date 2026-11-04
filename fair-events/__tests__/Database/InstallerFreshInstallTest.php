<?php
/**
 * Installer fresh-install tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Database;

// The installer needs a small table-tracking wpdb double in the same file and
// swaps the WordPress database global for the duration of each test.
// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use FairEvents\Database\Installer;
use FairEvents\Database\Schema;
use PHPUnit\Framework\TestCase;
use ReflectionClass;
use ReflectionMethod;

if ( ! defined( 'ABSPATH' ) ) {
	// Loads the dbDelta() stub from fixtures/wordpress/wp-admin/includes/upgrade.php.
	define( 'ABSPATH', dirname( __DIR__ ) . '/fixtures/wordpress/' );
}

/**
 * Tracks which tables exist and records every query outside dbDelta().
 */
class Installer_Fresh_Install_WPDB {
	/**
	 * WordPress table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Posts table name.
	 *
	 * @var string
	 */
	public $posts = 'wp_posts';

	/**
	 * Post meta table name.
	 *
	 * @var string
	 */
	public $postmeta = 'wp_postmeta';

	/**
	 * Existing tables, keyed by full name.
	 *
	 * @var array<string, true>
	 */
	public $tables = array();

	/**
	 * CREATE TABLE statements dbDelta() applied, keyed by full table name.
	 *
	 * @var array<string, string>
	 */
	public $table_sql = array();

	/**
	 * Whether a legacy fair_event post exists.
	 *
	 * @var bool
	 */
	public $has_legacy_event = false;

	/**
	 * Queries a migration ran, in order.
	 *
	 * @var array
	 */
	public $data_queries = array();

	/**
	 * Table setup and migration work, in order: 'table' for each dbDelta()
	 * statement, 'data' for each migration query.
	 *
	 * @var string[]
	 */
	public $log = array();

	/**
	 * Tables dbDelta() fails to create, keyed by full name.
	 *
	 * @var array<string, true>
	 */
	public $uncreatable_tables = array();

	/**
	 * Query fragments whose statements fail, as a database error would.
	 *
	 * @var string[]
	 */
	public $failing_queries = array();

	/**
	 * Columns that exist beyond the current schema, keyed by full table
	 * name, such as legacy columns dbDelta() leaves in place.
	 *
	 * @var array<string, string[]>
	 */
	public $legacy_columns = array();

	/**
	 * Charset clause for CREATE TABLE statements.
	 *
	 * @return string Empty clause.
	 */
	public function get_charset_collate() {
		return '';
	}

	/**
	 * Escape LIKE wildcards, as wpdb::esc_like() does.
	 *
	 * @param string $text Raw text.
	 * @return string Escaped text.
	 */
	public function esc_like( $text ) {
		return addcslashes( $text, '_%\\' );
	}

	/**
	 * Capture a prepared query.
	 *
	 * @param string $query   Query template.
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
	 * Record the table a dbDelta() statement creates.
	 *
	 * @param string $sql CREATE TABLE statement.
	 * @return void
	 */
	public function db_delta( $sql ) {
		$this->log[] = 'table';
		if ( preg_match( '/CREATE TABLE (\S+)/', $sql, $matches ) && ! isset( $this->uncreatable_tables[ $matches[1] ] ) ) {
			$this->tables[ $matches[1] ]    = true;
			$this->table_sql[ $matches[1] ] = $sql;
		}
	}

	/**
	 * Answer the installer's freshness checks.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return string|null First matching value.
	 */
	public function get_var( $prepared ) {
		if ( 0 === strpos( $prepared['query'], 'SHOW TABLES LIKE' ) ) {
			$pattern = '/^' . str_replace( array( '\\_', '%' ), array( '_', '.*' ), $prepared['args'][0] ) . '$/';
			foreach ( array_keys( $this->tables ) as $table ) {
				if ( preg_match( $pattern, $table ) ) {
					return $table;
				}
			}
			return null;
		}

		if ( 0 === strpos( $prepared['query'], 'SELECT ID FROM %i WHERE post_type' ) ) {
			return $this->has_legacy_event ? '1' : null;
		}

		$this->record( $prepared );

		// The timing backfill's completeness check: the doubled table has no rows.
		if ( 'SELECT COUNT(*) FROM %i WHERE timing_migrated = 0' === $prepared['query'] ) {
			return '0';
		}

		return null;
	}

	/**
	 * Record a migration query.
	 *
	 * @param array|string $prepared Query.
	 * @return int Affected rows.
	 */
	public function query( $prepared ) {
		$this->record( $prepared );

		$sql = is_array( $prepared ) ? $prepared['query'] . ' ' . implode( ' ', array_map( 'strval', $prepared['args'] ) ) : $prepared;
		foreach ( $this->failing_queries as $fragment ) {
			if ( false !== strpos( $sql, $fragment ) ) {
				return false;
			}
		}

		return 0;
	}

	/**
	 * Record a migration query in order.
	 *
	 * @param array|string $prepared Query.
	 * @return void
	 */
	private function record( $prepared ) {
		$this->data_queries[] = $prepared;
		$this->log[]          = 'data';
	}

	/**
	 * How many recorded migration queries match a template.
	 *
	 * @param string $query Query template.
	 * @return int Matching queries.
	 */
	public function count_queries( $query ) {
		$count = 0;
		foreach ( $this->data_queries as $prepared ) {
			if ( is_array( $prepared ) && $query === $prepared['query'] ) {
				++$count;
			}
		}
		return $count;
	}

	/**
	 * Record a migration query.
	 *
	 * @param array|string $prepared Query.
	 * @return array No rows.
	 */
	public function get_results( $prepared ) {
		$this->record( $prepared );

		// Columns dbDelta() created, and legacy columns it kept, exist.
		if ( is_array( $prepared ) && 0 === strpos( $prepared['query'], 'SHOW COLUMNS FROM %i LIKE %s' ) ) {
			$sql    = $this->table_sql[ $prepared['args'][0] ] ?? '';
			$column = stripslashes( $prepared['args'][1] );
			if ( in_array( $column, $this->legacy_columns[ $prepared['args'][0] ] ?? array(), true ) || preg_match( '/^\s*' . preg_quote( $column, '/' ) . '\s/m', $sql ) ) {
				return array( (object) array( 'Field' => $column ) );
			}
		}

		return array();
	}
}

/**
 * Covers installing on a site that never had Fair Events.
 */
class InstallerFreshInstallTest extends TestCase {

	/**
	 * Database double used by the test.
	 *
	 * @var Installer_Fresh_Install_WPDB
	 */
	private $db;

	/**
	 * Start from an empty database.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->db                      = new Installer_Fresh_Install_WPDB();
		$GLOBALS['wpdb']               = $this->db;
		$GLOBALS['_fair_test_options'] = array();
	}

	/**
	 * Restore the shared database double after each test.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb']               = new \Fair_Test_WPDB();
		$GLOBALS['_fair_test_options'] = array();
		parent::tearDown();
	}

	/**
	 * Every table the current schema defines.
	 *
	 * @return string[] Full table names, sorted.
	 */
	private function current_tables() {
		$tables = array();
		foreach ( ( new ReflectionClass( Schema::class ) )->getMethods() as $method ) {
			if ( preg_match( '/^get_\w+_table_sql$/', $method->getName() ) ) {
				preg_match( '/CREATE TABLE (\S+)/', $method->invoke( null ), $matches );
				$tables[] = $matches[1];
			}
		}
		sort( $tables );
		return $tables;
	}

	/**
	 * Assert the database holds exactly the current schema, written without
	 * running any migration, at the current version.
	 *
	 * @return void
	 */
	private function assert_current_schema_without_migrations() {
		$created = array_keys( $this->db->tables );
		sort( $created );

		$this->assertSame( $this->current_tables(), $created );
		$this->assertSame( array(), $this->db->data_queries );
		$this->assertSame( Schema::DB_VERSION, Schema::get_db_version() );
	}

	/**
	 * Plugin initialization on an empty database creates the current schema
	 * instead of running migrations against missing tables.
	 *
	 * @return void
	 */
	public function test_maybe_upgrade_on_empty_database_creates_current_schema() {
		Installer::maybe_upgrade();

		$this->assert_current_schema_without_migrations();
	}

	/**
	 * The activation hook on an empty database does the same.
	 *
	 * @return void
	 */
	public function test_install_on_empty_database_creates_current_schema() {
		Installer::install();

		$this->assert_current_schema_without_migrations();
	}

	/**
	 * Activation runs initialization and then the activation hook; repeating
	 * both afterwards changes nothing.
	 *
	 * @return void
	 */
	public function test_repeated_initialization_is_harmless() {
		Installer::maybe_upgrade();
		Installer::install();
		Installer::maybe_upgrade();
		Installer::install();

		$this->assert_current_schema_without_migrations();
	}

	/**
	 * Only a database with no version, no table and no legacy event is fresh.
	 *
	 * @return void
	 */
	public function test_freshness_requires_no_version_tables_or_legacy_events() {
		$is_fresh = new ReflectionMethod( Installer::class, 'is_fresh_install' );

		$this->assertTrue( $is_fresh->invoke( null ) );

		$GLOBALS['_fair_test_options'] = array( 'fair_events_db_version' => '0.0.0' );
		$this->assertFalse( $is_fresh->invoke( null ), 'A stored version is an upgrade.' );
		$GLOBALS['_fair_test_options'] = array();

		$this->db->tables = array( 'wp_fair_event_dates' => true );
		$this->assertFalse( $is_fresh->invoke( null ), 'Existing tables without a version are an upgrade.' );

		$this->db->tables = array( 'wp_fair_events_event_photos' => true );
		$this->assertFalse( $is_fresh->invoke( null ), 'A retired table is an upgrade.' );
		$this->db->tables = array();

		$this->db->has_legacy_event = true;
		$this->assertFalse( $is_fresh->invoke( null ), 'Events in post meta are an upgrade.' );
	}

	/**
	 * A missing version with existing tables still runs the migrations, the
	 * 3.33.0 signup repair included.
	 *
	 * @return void
	 */
	public function test_missing_version_with_existing_tables_runs_migrations() {
		$this->db->tables = array( 'wp_fair_events_signups' => true );

		Installer::maybe_upgrade();

		$this->assertContains(
			array(
				'query' => 'UPDATE %i SET over_capacity = %d WHERE over_capacity = %d',
				'args'  => array( 'wp_fair_events_signups', 0, 1 ),
			),
			$this->db->data_queries
		);
		$this->assertSame( Schema::DB_VERSION, Schema::get_db_version() );
	}

	/**
	 * Store a version, as a site upgrading from it would have.
	 *
	 * @param string $version Stored database version.
	 * @return void
	 */
	private function stored_version( $version ) {
		$GLOBALS['_fair_test_options'] = array( 'fair_events_db_version' => $version );
		$this->db->tables              = array( 'wp_fair_event_dates' => true );
	}

	/**
	 * Both entry points upgrade through one sequence: every table is
	 * prepared before the first migration query, and each pending migration
	 * runs once per upgrade.
	 *
	 * @return void
	 */
	public function test_upgrade_prepares_tables_then_runs_each_migration_once() {
		foreach ( array( 'maybe_upgrade', 'install' ) as $entry_point ) {
			$this->db        = new Installer_Fresh_Install_WPDB();
			$GLOBALS['wpdb'] = $this->db;
			$this->stored_version( '3.32.0' );

			Installer::$entry_point();

			$first_data = array_search( 'data', $this->db->log, true );
			$this->assertNotFalse( $first_data, $entry_point );
			$this->assertNotContains( 'table', array_slice( $this->db->log, $first_data ), $entry_point . ' prepares every table before migrating data.' );
			$this->assertSame( 1, $this->db->count_queries( 'UPDATE %i SET over_capacity = %d WHERE over_capacity = %d' ), $entry_point . ' runs 3.33.0 once.' );
			$this->assertSame( 0, $this->db->count_queries( 'UPDATE %i SET status = %s WHERE occurrence_type = %s AND (status IS NULL OR status NOT IN (%s, %s))' ), $entry_point . ' skips migrations the stored version already has.' );
			$this->assertSame( Schema::DB_VERSION, Schema::get_db_version(), $entry_point );
		}
	}

	/**
	 * The migrations that used to run only during activation (3.13.0 and
	 * 3.14.0) now run on upgrades found during initialization too.
	 *
	 * @return void
	 */
	public function test_upgrade_from_initialization_includes_activation_only_migrations() {
		$this->stored_version( '3.12.0' );

		Installer::maybe_upgrade();

		$columns = array();
		foreach ( $this->db->data_queries as $prepared ) {
			if ( is_array( $prepared ) && 'SHOW COLUMNS FROM %i LIKE %s' === $prepared['query'] ) {
				$columns[] = stripslashes( $prepared['args'][1] );
			}
		}
		$this->assertContains( 'disable_at', $columns );
		$this->assertContains( 'recurrence_scope', $columns );
	}

	/**
	 * Once an upgrade succeeds, repeated initialization and activation run
	 * no migration again.
	 *
	 * @return void
	 */
	public function test_repeated_checks_after_an_upgrade_run_no_migration() {
		$this->stored_version( '3.20.0' );
		Installer::maybe_upgrade();
		$this->assertSame( Schema::DB_VERSION, Schema::get_db_version() );

		$this->db->data_queries = array();
		Installer::maybe_upgrade();
		Installer::install();
		Installer::maybe_upgrade();

		$this->assertSame( array(), $this->db->data_queries );
		$this->assertSame( Schema::DB_VERSION, Schema::get_db_version() );
	}

	/**
	 * A table that cannot be created leaves the version unchanged and runs
	 * no migration, on an upgrade and on a fresh site, and the next check
	 * finishes the work.
	 *
	 * @return void
	 */
	public function test_failed_table_setup_records_nothing_and_retries() {
		$this->stored_version( '3.32.0' );
		$this->db->uncreatable_tables = array( 'wp_fair_events_signups' => true );

		Installer::maybe_upgrade();

		$this->assertSame( array(), $this->db->data_queries );
		$this->assertSame( '3.32.0', Schema::get_db_version() );

		$this->db->uncreatable_tables = array();
		Installer::maybe_upgrade();

		$this->assertSame( 1, $this->db->count_queries( 'UPDATE %i SET over_capacity = %d WHERE over_capacity = %d' ) );
		$this->assertSame( Schema::DB_VERSION, Schema::get_db_version() );
	}

	/**
	 * A fresh site whose table setup failed is not marked installed; the
	 * retry, which now sees tables, runs the migration sequence on the
	 * current schema and reaches the current version.
	 *
	 * @return void
	 */
	public function test_failed_fresh_install_is_retried() {
		$this->db->uncreatable_tables = array( 'wp_fair_events_schedule_items' => true );

		Installer::install();

		$this->assertFalse( Schema::has_db_version() );
		$this->assertSame( array(), $this->db->data_queries );

		$this->db->uncreatable_tables = array();
		Installer::maybe_upgrade();

		$this->assertSame( Schema::DB_VERSION, Schema::get_db_version() );
		$this->assertSame( 0, $this->db->count_queries( 'ALTER TABLE %i MODIFY start_datetime DATETIME DEFAULT NULL' ), 'Tables without the legacy column skip 3.30.0.' );
	}

	/**
	 * A failed required cleanup keeps the version below it; the next check
	 * retries only that cleanup and what follows, then reaches the current
	 * version.
	 *
	 * @return void
	 */
	public function test_failed_cleanup_keeps_retry_version() {
		$this->stored_version( '3.32.0' );
		$this->db->failing_queries = array( 'wp_fair_events_ticket_option_collaborators' );

		Installer::maybe_upgrade();

		$this->assertSame( '3.43.0', Schema::get_db_version() );
		$this->assertSame( 1, $this->db->count_queries( 'UPDATE %i SET over_capacity = %d WHERE over_capacity = %d' ) );

		$this->db->failing_queries = array();
		$this->db->data_queries    = array();
		Installer::maybe_upgrade();

		$this->assertSame( Schema::DB_VERSION, Schema::get_db_version() );
		$this->assertSame( 0, $this->db->count_queries( 'UPDATE %i SET over_capacity = %d WHERE over_capacity = %d' ), 'Completed migrations do not run again.' );
		$this->assertSame( 1, $this->db->count_queries( 'DROP TABLE IF EXISTS %i' ) - $this->count_gallery_drops(), 'The failed cleanup runs again.' );
	}

	/**
	 * Gallery table drops among the recorded queries.
	 *
	 * @return int Gallery drops.
	 */
	private function count_gallery_drops() {
		$count = 0;
		foreach ( $this->db->data_queries as $prepared ) {
			if ( is_array( $prepared ) && 'DROP TABLE IF EXISTS %i' === $prepared['query'] && 'wp_fair_events_ticket_option_collaborators' !== $prepared['args'][0] ) {
				++$count;
			}
		}
		return $count;
	}

	/**
	 * The timing steps run in dependency order: while the 3.45.0 backfill
	 * fails, override detection and the legacy column drop wait; the retry
	 * runs all three in order.
	 *
	 * @return void
	 */
	public function test_timing_steps_wait_for_the_backfill() {
		$this->stored_version( '3.44.0' );
		$this->db->legacy_columns  = array( 'wp_fair_event_dates' => array( 'start_datetime', 'end_datetime' ) );
		$this->db->failing_queries = array( 'ADD COLUMN timing_migrated' );

		Installer::maybe_upgrade();

		$this->assertSame( '3.44.0', Schema::get_db_version() );
		$this->assertSame( array(), $this->timing_steps() );

		$this->db->failing_queries = array();
		$this->db->data_queries    = array();
		Installer::maybe_upgrade();

		$this->assertSame( Schema::DB_VERSION, Schema::get_db_version() );
		// 3.47.0 reruns the backfill for rows written since, then drops.
		$this->assertSame( array( '3.45.0', '3.46.0', '3.45.0', '3.47.0' ), $this->timing_steps() );
	}

	/**
	 * The timing step each recorded query belongs to, in order, with
	 * consecutive queries of one step collapsed.
	 *
	 * @return string[] Step versions.
	 */
	private function timing_steps() {
		$steps = array();
		foreach ( $this->db->data_queries as $prepared ) {
			$query = is_array( $prepared ) ? $prepared['query'] : $prepared;
			if ( false !== strpos( $query, 'timing_migrated = 1' ) ) {
				$step = '3.45.0';
			} elseif ( false !== strpos( $query, "occurrence_type = 'generated' AND master_id IS NOT NULL" ) ) {
				$step = '3.46.0';
			} elseif ( false !== strpos( $query, 'DROP COLUMN start_datetime' ) ) {
				$step = '3.47.0';
			} else {
				continue;
			}
			if ( end( $steps ) !== $step ) {
				$steps[] = $step;
			}
		}
		return $steps;
	}
}
