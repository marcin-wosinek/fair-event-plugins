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
		if ( preg_match( '/CREATE TABLE (\S+)/', $sql, $matches ) ) {
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

		$this->data_queries[] = $prepared;

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
		$this->data_queries[] = $prepared;
		return 0;
	}

	/**
	 * Record a migration query.
	 *
	 * @param array|string $prepared Query.
	 * @return array No rows.
	 */
	public function get_results( $prepared ) {
		$this->data_queries[] = $prepared;

		// Columns dbDelta() created exist.
		if ( is_array( $prepared ) && 0 === strpos( $prepared['query'], 'SHOW COLUMNS FROM %i LIKE %s' ) ) {
			$sql    = $this->table_sql[ $prepared['args'][0] ] ?? '';
			$column = stripslashes( $prepared['args'][1] );
			if ( preg_match( '/^\s*' . preg_quote( $column, '/' ) . '\s/m', $sql ) ) {
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
}
