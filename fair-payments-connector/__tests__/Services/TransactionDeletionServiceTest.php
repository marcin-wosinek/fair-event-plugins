<?php
/**
 * Transaction deletion atomicity tests (#1618).
 *
 * Guards the core safety requirement: a failure partway through the
 * multi-table delete must roll back every preceding mutation and leave the
 * transaction row intact, never a partially-deleted record.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Services\TransactionDeletionService;
use Fair_Test_Transaction_Deletion_WPDB;
use Fair_Test_WPDB;

require_once __DIR__ . '/Fair_Test_Transaction_Deletion_WPDB.php';

/**
 * Tests for TransactionDeletionService::delete().
 */
class TransactionDeletionServiceTest extends TestCase {

	/**
	 * The fake $wpdb installed for the running test.
	 *
	 * @var Fair_Test_Transaction_Deletion_WPDB
	 */
	private $wpdb;

	/**
	 * Install the specialized fake as the global $wpdb.
	 */
	protected function setUp(): void {
		$this->wpdb = new Fair_Test_Transaction_Deletion_WPDB();
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, no real $wpdb exists here.
		$GLOBALS['wpdb'] = $this->wpdb;
	}

	/**
	 * Restore the plain fake so later test files aren't affected.
	 */
	protected function tearDown(): void {
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, no real $wpdb exists here.
		$GLOBALS['wpdb'] = new Fair_Test_WPDB();
	}

	/** A successful delete removes owned rows, detaches related rows, commits, and audits. */
	public function test_successful_delete_removes_and_detaches_then_commits() {
		$this->wpdb->transaction_row = (object) array(
			'id'                => 99,
			'mollie_payment_id' => 'tr_test_99',
		);

		$result = TransactionDeletionService::delete( 99 );

		$this->assertTrue( $result );

		$this->assertContains( 'wp_fair_payment_line_items', $this->wpdb->tables_touched( 'delete' ) );
		$this->assertContains( 'wp_fair_payment_entry_transactions', $this->wpdb->tables_touched( 'delete' ) );
		$this->assertContains( 'wp_fair_payment_transactions', $this->wpdb->tables_touched( 'delete' ) );

		$updated_tables = $this->wpdb->tables_touched( 'update' );
		$this->assertContains( 'wp_fair_payment_financial_entries', $updated_tables );
		$this->assertContains( 'wp_fair_payment_log', $updated_tables );

		$queries = $this->recorded_queries();
		$this->assertContains( 'COMMIT', $queries );
		$this->assertNotContains( 'ROLLBACK', $queries );

		// Exactly one audit row: the detached success entry.
		$this->assertCount( 1, $this->wpdb->inserted_rows );
		$audit = $this->wpdb->inserted_rows[0];
		$this->assertSame( 'transaction_deleted', $audit['event'] );
		$this->assertNull( $audit['transaction_id'] );
		$context = json_decode( $audit['context'], true );
		$this->assertSame( 99, $context['deleted_transaction_id'] );
		$this->assertSame( 'tr_test_99', $context['mollie_payment_id'] );
	}

	/** A missing transaction fails cleanly without touching any table. */
	public function test_missing_transaction_returns_false_without_side_effects() {
		$this->wpdb->transaction_row = null;

		$result = TransactionDeletionService::delete( 123 );

		$this->assertFalse( $result );
		$this->assertSame( array(), $this->wpdb->tables_touched( 'delete' ) );
		$this->assertSame( array(), $this->wpdb->tables_touched( 'update' ) );
		$this->assertSame( array(), $this->wpdb->inserted_rows );
	}

	/** A failure partway through rolls back every preceding mutation and leaves the transaction intact. */
	public function test_failure_partway_through_rolls_back_and_keeps_transaction_intact() {
		$this->wpdb->transaction_row = (object) array(
			'id'                => 55,
			'mollie_payment_id' => 'tr_test_55',
		);
		// Fail on the financial-entries detach step, after line items and the
		// junction table have already been mutated in this same DB transaction.
		$this->wpdb->fail_on = 'update:wp_fair_payment_financial_entries';

		$result = TransactionDeletionService::delete( 55 );

		$this->assertFalse( $result );

		// The transaction row itself was never deleted.
		$this->assertNotContains( 'wp_fair_payment_transactions', $this->wpdb->tables_touched( 'delete' ) );
		// The log table was never reached either — the failure happened before it.
		$this->assertNotContains( 'wp_fair_payment_log', $this->wpdb->tables_touched( 'update' ) );

		$queries = $this->recorded_queries();
		$this->assertContains( 'ROLLBACK', $queries );
		$this->assertNotContains( 'COMMIT', $queries );

		// Exactly one audit row: the failure entry, logged against the still-existing transaction.
		$this->assertCount( 1, $this->wpdb->inserted_rows );
		$audit = $this->wpdb->inserted_rows[0];
		$this->assertSame( 'transaction_delete_failed', $audit['event'] );
		$this->assertSame( 'error', $audit['level'] );
		$this->assertSame( 55, $audit['transaction_id'] );
		$context = json_decode( $audit['context'], true );
		$this->assertSame( 'tr_test_55', $context['mollie_payment_id'] );
	}

	/**
	 * Raw SQL strings passed to $wpdb->query() during the running test.
	 *
	 * @return string[]
	 */
	private function recorded_queries() {
		$queries = array();
		foreach ( $this->wpdb->calls as $call ) {
			if ( 'query' === $call[0] ) {
				$queries[] = $call[1];
			}
		}
		return $queries;
	}
}
