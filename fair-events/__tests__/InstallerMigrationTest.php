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
	}
}
