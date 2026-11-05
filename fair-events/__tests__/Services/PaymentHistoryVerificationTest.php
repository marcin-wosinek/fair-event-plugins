<?php
/**
 * Verification classification tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\PaymentHistoryVerification;
use PHPUnit\Framework\TestCase;

/**
 * The verification report tells the differences the contract introduces on
 * purpose (§8.4) apart from unexpected ones, which block cutover.
 */
class PaymentHistoryVerificationTest extends TestCase {

	/**
	 * A ledger row.
	 *
	 * @param int    $id       Transaction.
	 * @param string $amount   Total.
	 * @param string $kind     charge or refund.
	 * @param string $currency Currency.
	 * @return array
	 */
	private static function ledger( $id, $amount, $kind = 'charge', $currency = 'EUR' ) {
		return array(
			'transaction_id' => $id,
			'kind'           => $kind,
			'amount'         => $amount,
			'currency'       => $currency,
		);
	}

	/**
	 * A link sum.
	 *
	 * @param int    $id        Transaction.
	 * @param string $allocated Allocated on the date.
	 * @param string $currency  Currency.
	 * @return array
	 */
	private static function link( $id, $allocated, $currency = 'EUR' ) {
		return array(
			'transaction_id' => $id,
			'allocated'      => $allocated,
			'currency'       => $currency,
		);
	}

	/**
	 * Classification context.
	 *
	 * @param int[] $shared     Fully allocated shared transactions.
	 * @param int[] $unresolved Transactions with an open finding.
	 * @param int[] $reconciled Transactions an administrator decided.
	 * @return array
	 */
	private static function context( array $shared = array(), array $unresolved = array(), array $reconciled = array() ) {
		return array(
			'shared'     => array_fill_keys( $shared, true ),
			'unresolved' => array_fill_keys( $unresolved, true ),
			'reconciled' => array_fill_keys( $reconciled, true ),
		);
	}

	/**
	 * Matching ledger and links: no difference.
	 */
	public function test_matching_revenue(): void {
		$result = PaymentHistoryVerification::classify_revenue(
			array( self::ledger( 1, '30.00' ), self::ledger( 2, '20.00' ) ),
			array( self::link( 1, '30.00' ), self::link( 2, '20.00' ) ),
			self::context()
		);

		$this->assertSame( 50.0, $result['EUR']['source'] );
		$this->assertSame( 50.0, $result['EUR']['target'] );
		$this->assertSame( array(), $result['EUR']['differences'] );
		$this->assertSame( 0.0, $result['EUR']['unexpected'] );
	}

	/**
	 * Example 7: the ledger counts a shared transaction in full on each
	 * date; links count the date's allocation. Explained.
	 */
	public function test_shared_transaction_is_explained(): void {
		$result = PaymentHistoryVerification::classify_revenue(
			array( self::ledger( 3, '36.00' ) ),
			array( self::link( 3, '12.00' ) ),
			self::context( array( 3 ) )
		);

		$this->assertSame( 'shared_transaction', $result['EUR']['differences'][0]['cause'] );
		$this->assertSame( 0.0, $result['EUR']['unexpected'] );
	}

	/**
	 * The same difference without a fully allocated shared transaction is
	 * unexpected and blocks.
	 */
	public function test_unexplained_shortfall_is_unexpected(): void {
		$result = PaymentHistoryVerification::classify_revenue(
			array( self::ledger( 3, '36.00' ) ),
			array( self::link( 3, '12.00' ) ),
			self::context()
		);

		$this->assertSame( 'unexpected', $result['EUR']['differences'][0]['cause'] );
		$this->assertSame( -24.0, $result['EUR']['unexpected'] );
	}

	/**
	 * An administrator's decision explains the difference it makes: a
	 * split that doesn't follow the ledger, or a payment kept without a
	 * link (§6.3).
	 */
	public function test_reconciled_transaction_is_explained(): void {
		$result = PaymentHistoryVerification::classify_revenue(
			array( self::ledger( 13, '24.00' ), self::ledger( 10, '15.00' ) ),
			array( self::link( 13, '12.00' ) ),
			self::context( array(), array(), array( 13, 10 ) )
		);

		$causes = array_column( $result['EUR']['differences'], 'cause', 'transaction_id' );
		$this->assertSame(
			array(
				10 => 'reconciled',
				13 => 'reconciled',
			),
			$causes
		);
		$this->assertSame( 0.0, $result['EUR']['unexpected'] );
	}

	/**
	 * An open finding still reads as unresolved, even with a reconciled link
	 * on the same transaction.
	 */
	public function test_open_finding_wins_over_reconciled(): void {
		$result = PaymentHistoryVerification::classify_revenue(
			array( self::ledger( 13, '24.00' ) ),
			array( self::link( 13, '12.00' ) ),
			self::context( array(), array( 13 ), array( 13 ) )
		);

		$this->assertSame( 'unresolved', $result['EUR']['differences'][0]['cause'] );
	}

	/**
	 * Example 22: the ledger subtracts a refund-labelled row; the link
	 * keeps it as a record that never counts.
	 */
	public function test_refund_record_is_explained(): void {
		$result = PaymentHistoryVerification::classify_revenue(
			array( self::ledger( 14, '20.00' ), self::ledger( 14, '20.00', 'refund' ) ),
			array( self::link( 14, '20.00' ) ),
			self::context()
		);

		$this->assertSame( 0.0, $result['EUR']['source'] );
		$this->assertSame( 20.0, $result['EUR']['target'] );
		$this->assertSame( 'legacy_refund_record', $result['EUR']['differences'][0]['cause'] );
		$this->assertSame( 0.0, $result['EUR']['unexpected'] );
	}

	/**
	 * Examples 11, 14, 21: money with an open finding is listed, never
	 * unexpected, and never counted as allocated.
	 */
	public function test_unresolved_transaction_is_explained(): void {
		$result = PaymentHistoryVerification::classify_revenue(
			array( self::ledger( 13, '24.00' ) ),
			array(),
			self::context( array(), array( 13 ) )
		);

		$this->assertSame( 0.0, $result['EUR']['target'] );
		$this->assertSame( 'unresolved', $result['EUR']['differences'][0]['cause'] );
		$this->assertSame( 0.0, $result['EUR']['unexpected'] );
	}

	/**
	 * A paid purchase the ledger reader can't reach counts in links only.
	 */
	public function test_paid_purchase_outside_ledger_is_explained(): void {
		$result = PaymentHistoryVerification::classify_revenue(
			array(),
			array( self::link( 9, '15.00' ) ),
			self::context()
		);

		$this->assertSame( 'not_in_ledger', $result['EUR']['differences'][0]['cause'] );
		$this->assertSame( 0.0, $result['EUR']['unexpected'] );
	}

	/**
	 * Ledger money that links lost, with no finding, is unexpected.
	 */
	public function test_missing_links_are_unexpected(): void {
		$result = PaymentHistoryVerification::classify_revenue(
			array( self::ledger( 2, '20.00' ) ),
			array(),
			self::context()
		);

		$this->assertSame( 'unexpected', $result['EUR']['differences'][0]['cause'] );
		$this->assertSame( -20.0, $result['EUR']['unexpected'] );
	}

	/**
	 * Currencies are compared separately, never converted (§5.7).
	 */
	public function test_currencies_are_separate(): void {
		$result = PaymentHistoryVerification::classify_revenue(
			array( self::ledger( 1, '10.00' ), self::ledger( 2, '30.00', 'charge', 'usd' ) ),
			array( self::link( 1, '10.00' ), self::link( 2, '30.00', 'USD' ) ),
			self::context()
		);

		$this->assertSame( array( 'EUR', 'USD' ), array_keys( $result ) );
		$this->assertSame( 30.0, $result['USD']['target'] );
	}

	/**
	 * Admissions: §4.1 replacing gap G3 is the only allowed difference.
	 */
	public function test_admissions_comparison(): void {
		$this->assertSame(
			array(
				'source'     => 3,
				'target'     => 4,
				'explained'  => array( 'legacy_rule' => 1 ),
				'unexpected' => 0,
			),
			PaymentHistoryVerification::compare_admissions( 3, 4, 1 )
		);
		$this->assertSame( -1, PaymentHistoryVerification::compare_admissions( 4, 3, 0 )['unexpected'] );
	}
}
