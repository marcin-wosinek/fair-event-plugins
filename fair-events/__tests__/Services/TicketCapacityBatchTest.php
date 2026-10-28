<?php
/**
 * TicketCapacity::remaining_for_event_dates() tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Models\EventDates;
use FairEvents\Services\TicketCapacity;
use PHPUnit\Framework\TestCase;
use ReflectionProperty;

require_once __DIR__ . '/Coverage_Test_WPDB.php';

/**
 * Remaining places of already loaded event dates (#1996).
 */
class TicketCapacityBatchTest extends TestCase {

	/**
	 * The bootstrap's $wpdb, restored after each test.
	 *
	 * @var object
	 */
	private $original_wpdb;

	/**
	 * The test double.
	 *
	 * @var Coverage_Test_WPDB
	 */
	private $wpdb;

	/**
	 * Install the double and empty the master cache.
	 */
	protected function setUp(): void {
		parent::setUp();

		$this->original_wpdb = $GLOBALS['wpdb'];
		$this->wpdb          = new Coverage_Test_WPDB();
		$GLOBALS['wpdb']     = $this->wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- swapped for the test double, restored in tearDown().
		self::reset_master_cache();
	}

	/**
	 * Restore the bootstrap's $wpdb and empty the master cache.
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->original_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the bootstrap's $wpdb.
		self::reset_master_cache();

		parent::tearDown();
	}

	/**
	 * Empty EventDates' per-request master cache.
	 *
	 * @return void
	 */
	private static function reset_master_cache() {
		$property = new ReflectionProperty( EventDates::class, 'master_cache' );
		$property->setValue( null, array() );
	}

	/** No dates, no counts. */
	public function test_empty_input() {
		$this->assertSame( array(), TicketCapacity::remaining_for_event_dates( array() ) );
		$this->assertSame( array(), $this->wpdb->queries );
	}

	/** An unlimited date is null and counts no admissions. */
	public function test_unlimited_dates_count_nothing() {
		$this->wpdb->seed_series( 100, 3 );
		$dates = EventDates::get_by_ids( array( 100, 101, 102 ) );

		$this->wpdb->queries = array();
		$this->assertSame(
			array(
				100 => null,
				101 => null,
				102 => null,
			),
			TicketCapacity::remaining_for_event_dates( $dates )
		);
		$this->assertSame( array(), $this->wpdb->queries );
	}

	/**
	 * A limited date subtracts its admissions, never below zero, and the
	 * result keeps the given order, keyed by ID.
	 */
	public function test_limited_dates_subtract_admissions_in_given_order() {
		$this->wpdb->seed_series( 100, 3, 2 );
		$this->wpdb->taken[100] = 1;
		$this->wpdb->taken[102] = 3;
		$loaded                 = EventDates::get_by_ids( array( 100, 101, 102 ) );

		$remaining = TicketCapacity::remaining_for_event_dates( array( $loaded[102], $loaded[100], $loaded[101] ) );

		$this->assertSame(
			array(
				102 => 0,
				100 => 1,
				101 => 2,
			),
			$remaining
		);
		$this->assertCount( 2 * 3, $this->wpdb->admission_counts() );
	}

	/** A date with no row is unlimited for the single-date lookup too. */
	public function test_missing_date_is_unlimited() {
		$this->assertNull( TicketCapacity::remaining_for_event_date( 404 ) );
	}

	/** The single-date lookup agrees with the batch. */
	public function test_single_date_matches_batch() {
		$this->wpdb->seed_series( 100, 2, 4 );
		$this->wpdb->taken[101] = 3;

		$this->assertSame( 1, TicketCapacity::remaining_for_event_date( 101 ) );
	}
}
