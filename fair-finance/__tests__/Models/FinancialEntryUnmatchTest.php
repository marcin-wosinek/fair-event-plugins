<?php
/**
 * Unmatching an entry from all its transactions (#1986).
 *
 * @package FairFinance
 */

namespace FairFinance\Tests\Models;

use FairFinance\Models\FinancialEntry;
use PHPUnit\Framework\TestCase;

// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

/**
 * Records the writes unmatching makes, failing a chosen one.
 */
class UnmatchRecordingWpdb {
	/**
	 * Table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Operations in order: transaction statements, then table writes.
	 *
	 * @var string[]
	 */
	public $log = array();

	/**
	 * Operation that fails: 'delete' or 'update'.
	 *
	 * @var string|null
	 */
	public $fail = null;

	/**
	 * Record a transaction statement.
	 *
	 * @param string $sql Statement.
	 * @return int
	 */
	public function query( $sql ) {
		$this->log[] = $sql;
		return 0;
	}

	/**
	 * Record a delete.
	 *
	 * @param string $table Table.
	 * @return int|false
	 */
	public function delete( $table ) {
		$this->log[] = "delete $table";
		return 'delete' === $this->fail ? false : 0;
	}

	/**
	 * Record an update.
	 *
	 * @param string $table Table.
	 * @param array  $data Data.
	 * @return int|false
	 */
	public function update( $table, $data ) {
		$this->log[] = "update $table " . json_encode( $data ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode
		return 'update' === $this->fail ? false : 0;
	}
}

/**
 * Both representations change together or not at all.
 */
class FinancialEntryUnmatchTest extends TestCase {
	/**
	 * Previous global.
	 *
	 * @var mixed
	 */
	private $previous;

	/** Install the recording database. */
	protected function setUp(): void {
		$this->previous  = $GLOBALS['wpdb'] ?? null;
		$GLOBALS['wpdb'] = new UnmatchRecordingWpdb();
	}

	/** Restore the previous database. */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->previous;
	}

	/** Junction links and the legacy column are cleared in one transaction. */
	public function test_clears_both_representations_atomically() {
		$this->assertTrue( FinancialEntry::unmatch_transaction( 12 ) );
		$this->assertSame(
			array(
				'START TRANSACTION',
				'delete wp_fair_payment_entry_transactions',
				'update wp_fair_payment_financial_entries {"transaction_id":null}',
				'COMMIT',
			),
			$GLOBALS['wpdb']->log
		);
	}

	/** A failed link deletion is reported and leaves the legacy column alone. */
	public function test_failed_link_deletion_rolls_back() {
		$GLOBALS['wpdb']->fail = 'delete';
		$this->assertFalse( FinancialEntry::unmatch_transaction( 12 ) );
		$this->assertSame(
			array(
				'START TRANSACTION',
				'delete wp_fair_payment_entry_transactions',
				'ROLLBACK',
			),
			$GLOBALS['wpdb']->log
		);
	}

	/** A failed legacy update rolls the deleted links back. */
	public function test_failed_legacy_update_rolls_back() {
		$GLOBALS['wpdb']->fail = 'update';
		$this->assertFalse( FinancialEntry::unmatch_transaction( 12 ) );
		$this->assertSame( 'ROLLBACK', end( $GLOBALS['wpdb']->log ) );
		$this->assertNotContains( 'COMMIT', $GLOBALS['wpdb']->log );
	}
}
