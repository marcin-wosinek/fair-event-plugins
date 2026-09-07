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
use FairEvents\Database\Schema;
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

		$this->assertSame( '3.33.0', Schema::DB_VERSION );
		$this->assertStringContainsString( 'UPDATE %i SET over_capacity = %d WHERE over_capacity = %d', $wpdb->executed['query'] );
		$this->assertSame( array( 'wp_fair_events_signups', 0, 1 ), $wpdb->executed['args'] );
	}
}
