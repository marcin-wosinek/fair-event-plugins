<?php
/**
 * PaymentLogRetentionHooks and PaymentLogRetention tests
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Hooks;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Database\PaymentLogRepository;
use FairPaymentsConnector\Hooks\PaymentLogRetentionHooks;
use FairPaymentsConnector\Services\PaymentLogRetention;
use FairPaymentsConnector\Tests\Database\PaymentLogWPDB;

require_once dirname( __DIR__ ) . '/Database/fixtures-payment-log-wpdb.php';

/**
 * Retention window, daily cron registration and batched pruning.
 */
class PaymentLogRetentionHooksTest extends TestCase {

	/**
	 * Recording $wpdb.
	 *
	 * @var PaymentLogWPDB
	 */
	private $wpdb;

	/**
	 * The $wpdb installed before this test.
	 *
	 * @var object|null
	 */
	private $previous_wpdb;

	/**
	 * Reset cron and filters and install the fake $wpdb.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_cron']    = array();
		$GLOBALS['_fair_test_filters'] = array();
		$this->previous_wpdb           = $GLOBALS['wpdb'] ?? null;
		$this->wpdb                    = new PaymentLogWPDB();
		$GLOBALS['wpdb']               = $this->wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- unit test installs a $wpdb double.
	}

	/**
	 * Restore the suite's $wpdb and clear filters.
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb']               = $this->previous_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the suite's $wpdb double.
		$GLOBALS['_fair_test_filters'] = array();
	}

	/**
	 * Make the retention filter return a value.
	 *
	 * @param mixed $value Filtered value.
	 * @return void
	 */
	private function filter_days( $value ) {
		$GLOBALS['_fair_test_filters'][ PaymentLogRetention::FILTER ] = function () use ( $value ) {
			return $value;
		};
	}

	/**
	 * Without a filter the window is 90 days.
	 */
	public function test_default_window_is_ninety_days() {
		$this->assertSame( 90, PaymentLogRetention::days() );
	}

	/**
	 * A positive integer from the filter is used.
	 */
	public function test_filter_overrides_the_window() {
		$this->filter_days( 30 );
		$this->assertSame( 30, PaymentLogRetention::days() );

		$this->filter_days( '7' );
		$this->assertSame( 7, PaymentLogRetention::days() );
	}

	/**
	 * Invalid filter values fall back to the default.
	 *
	 * @param mixed $value Filtered value.
	 */
	#[DataProvider( 'invalid_windows' )]
	public function test_invalid_window_falls_back_to_default( $value ) {
		$this->filter_days( $value );
		$this->assertSame( PaymentLogRetention::DEFAULT_DAYS, PaymentLogRetention::days() );
	}

	/**
	 * Filter values that are not positive integers.
	 *
	 * @return array
	 */
	public static function invalid_windows() {
		return array(
			'zero'           => array( 0 ),
			'negative'       => array( -5 ),
			'float'          => array( 1.5 ),
			'null'           => array( null ),
			'false'          => array( false ),
			'non-digit text' => array( '30 days' ),
			'zero string'    => array( '0' ),
			'array'          => array( array( 30 ) ),
		);
	}

	/**
	 * One daily event is scheduled, due straight away.
	 */
	public function test_schedules_one_daily_event_due_now() {
		$before = time();
		( new PaymentLogRetentionHooks() )->schedule_event();

		$this->assertCount( 1, $GLOBALS['_fair_test_cron'] );
		$event = $GLOBALS['_fair_test_cron'][0];
		$this->assertSame( PaymentLogRetentionHooks::CRON_HOOK, $event['hook'] );
		$this->assertSame( 'daily', $event['recurrence'] );
		$this->assertSame( array(), $event['args'] );
		$this->assertGreaterThanOrEqual( $before, $event['timestamp'] );
		$this->assertLessThanOrEqual( time(), $event['timestamp'] );
	}

	/**
	 * Loading the plugin again does not add a second event.
	 */
	public function test_does_not_schedule_a_duplicate_event() {
		$hooks = new PaymentLogRetentionHooks();
		$hooks->init();
		$hooks->init();

		$this->assertCount( 1, $GLOBALS['_fair_test_cron'] );
	}

	/**
	 * Deactivation removes the event and leaves other events alone.
	 */
	public function test_unschedule_removes_only_this_event() {
		( new PaymentLogRetentionHooks() )->schedule_event();
		wp_schedule_event( time(), 'hourly', 'some_other_hook' );

		PaymentLogRetentionHooks::unschedule();

		$this->assertSame( array( 'some_other_hook' ), array_column( $GLOBALS['_fair_test_cron'], 'hook' ) );
	}

	/**
	 * The callback prunes with the filtered window and stops after a partial batch.
	 */
	public function test_prune_uses_the_window_and_stops_after_a_partial_batch() {
		$this->filter_days( 30 );
		$this->wpdb->query_results = array( PaymentLogRetentionHooks::BATCH_SIZE, 12 );

		$deleted = ( new PaymentLogRetentionHooks() )->prune();

		$this->assertSame( PaymentLogRetentionHooks::BATCH_SIZE + 12, $deleted );
		$this->assertCount( 2, $this->wpdb->queries );
		foreach ( $this->wpdb->queries as $query ) {
			$this->assertSame( 30, $query[2] );
			$this->assertSame( PaymentLogRetentionHooks::BATCH_SIZE, $query[3] );
		}
	}

	/**
	 * A backlog is deleted at most MAX_BATCHES batches per run.
	 */
	public function test_prune_is_bounded_per_run() {
		$this->wpdb->query_results = array_fill( 0, PaymentLogRetentionHooks::MAX_BATCHES + 5, PaymentLogRetentionHooks::BATCH_SIZE );

		$deleted = ( new PaymentLogRetentionHooks() )->prune();

		$this->assertSame( PaymentLogRetentionHooks::BATCH_SIZE * PaymentLogRetentionHooks::MAX_BATCHES, $deleted );
		$this->assertCount( PaymentLogRetentionHooks::MAX_BATCHES, $this->wpdb->queries );
	}

	/**
	 * A failed delete stops the run, reports false and writes no log row.
	 */
	public function test_prune_stops_and_reports_a_database_failure() {
		$this->wpdb->query_results = array( PaymentLogRetentionHooks::BATCH_SIZE, false, 5 );

		$deleted = ( new PaymentLogRetentionHooks( new PaymentLogRepository() ) )->prune();

		$this->assertFalse( $deleted );
		$this->assertCount( 2, $this->wpdb->queries );
		$this->assertSame( array(), $this->wpdb->inserted_rows );
	}
}
