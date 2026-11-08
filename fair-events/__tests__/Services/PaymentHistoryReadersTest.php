<?php
/**
 * Payment history reader activation and revenue rule tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\PaymentHistoryReaders;
use FairEvents\Services\PurchasePaymentHistory;
use PHPUnit\Framework\TestCase;

/**
 * Covers PAYMENT_HISTORY_MIGRATION.md §8.14: what blocks the stage 5 reader
 * activation, what it records, that only a recorded activation turns the
 * Events readers on, and how paid allocations become a revenue summary
 * (§7). The activation with its locks and audit, and the live readers,
 * are covered by EventStatistics.api.spec.js.
 */
class PaymentHistoryReadersTest extends TestCase {

	/**
	 * Facts of a site ready to switch.
	 *
	 * @return array
	 */
	private static function ready() {
		return array(
			'storage'                 => true,
			'ownership_cutover'       => true,
			'cutover_activated_at'    => '2026-11-01 10:00:00',
			'verified'                => true,
			'verification_checked_at' => '2026-11-02 09:00:00',
			'payment_information'     => true,
			'outstanding_work'        => array(),
			'relationship_admissions' => array(),
		);
	}

	/**
	 * Reset the stored options.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_options'] = array();
	}

	/**
	 * A verified site after the stage 4 activation can switch.
	 *
	 * @return void
	 */
	public function test_ready_site_has_no_blockers(): void {
		$this->assertSame( array(), PaymentHistoryReaders::blockers( self::ready() ) );
	}

	/**
	 * Each missing condition blocks with its own code.
	 *
	 * @return void
	 */
	public function test_each_condition_blocks_with_its_code(): void {
		$cases = array(
			'storage'                 => array( false, 'storage_unavailable' ),
			'ownership_cutover'       => array( false, 'ownership_cutover_inactive' ),
			'verified'                => array( false, 'migration_unverified' ),
			'payment_information'     => array( false, 'payment_information_unavailable' ),
			'outstanding_work'        => array( array( 'payment' => array( 'failed' => 1 ) ), 'shadow_work_outstanding' ),
			'relationship_admissions' => array( array( 12 ), 'relationship_admissions' ),
		);
		foreach ( $cases as $fact => list( $value, $code ) ) {
			$facts          = self::ready();
			$facts[ $fact ] = $value;
			$this->assertSame( array( $code ), PaymentHistoryReaders::blockers( $facts ), $fact );
		}
	}

	/**
	 * A verification from before the stage 4 activation doesn't describe
	 * what the lifecycle wrote since, so it can't support the switch.
	 *
	 * @return void
	 */
	public function test_verification_must_follow_the_ownership_cutover(): void {
		$facts                            = self::ready();
		$facts['verification_checked_at'] = '2026-10-31 23:59:59';
		$this->assertSame( array( 'verification_before_cutover' ), PaymentHistoryReaders::blockers( $facts ) );

		$facts['verification_checked_at'] = '';
		$this->assertSame( array( 'verification_before_cutover' ), PaymentHistoryReaders::blockers( $facts ) );
	}

	/**
	 * Without the stage 4 activation every blocker of an unprepared site is
	 * listed together.
	 *
	 * @return void
	 */
	public function test_unprepared_site_lists_every_blocker(): void {
		$this->assertSame(
			array( 'storage_unavailable', 'ownership_cutover_inactive', 'migration_unverified', 'payment_information_unavailable' ),
			PaymentHistoryReaders::blockers(
				array(
					'storage'                 => false,
					'ownership_cutover'       => false,
					'cutover_activated_at'    => null,
					'verified'                => false,
					'verification_checked_at' => null,
					'payment_information'     => false,
					'outstanding_work'        => array(),
					'relationship_admissions' => array(),
				)
			)
		);
	}

	/**
	 * The record names the verification it relied on and the stage 4
	 * activation it followed.
	 *
	 * @return void
	 */
	public function test_record_names_the_verification_and_the_cutover(): void {
		$summary = array(
			'event_dates' => 3,
			'blocking'    => 0,
			'incomplete'  => 1,
		);
		$record  = PaymentHistoryReaders::record( self::ready(), $summary, 7, '2026-11-03 08:00:00' );

		$this->assertSame( '2026-11-03 08:00:00', $record['activated_at'] );
		$this->assertSame( PaymentHistoryReaders::REASON_VERIFIED, $record['reason'] );
		$this->assertSame( 7, $record['user_id'] );
		$this->assertSame( 'backfill-verification:2026-11-02 09:00:00', $record['reference'] );
		$this->assertSame( '2026-11-01 10:00:00', $record['verification']['cutover_activated_at'] );
		$this->assertSame( $summary, $record['verification']['comparisons'] );
	}

	/**
	 * Only a recorded activation is one; an empty or malformed option isn't.
	 *
	 * @return void
	 */
	public function test_activation_needs_an_activation_time(): void {
		$this->assertNull( PaymentHistoryReaders::get_activation() );
		$this->assertFalse( PaymentHistoryReaders::active() );

		$GLOBALS['_fair_test_options'][ PaymentHistoryReaders::OPTION ] = array( 'reason' => 'reader_cutover' );
		$this->assertNull( PaymentHistoryReaders::get_activation() );

		$GLOBALS['_fair_test_options'][ PaymentHistoryReaders::OPTION ] = 'yes';
		$this->assertNull( PaymentHistoryReaders::get_activation() );

		$GLOBALS['_fair_test_options'][ PaymentHistoryReaders::OPTION ] = array( 'activated_at' => '2026-11-03 08:00:00' );
		$this->assertSame( '2026-11-03 08:00:00', PaymentHistoryReaders::get_activation()['activated_at'] );
	}

	/**
	 * Unreadable payment information is unavailable: no amount, never 0.
	 *
	 * @return void
	 */
	public function test_unavailable_revenue_has_no_amount(): void {
		$summary = PurchasePaymentHistory::summarize(
			array( self::link( 1, '30.00', 'EUR', '2026-10-01 10:00:00' ) ),
			array(),
			'eur',
			false
		);

		$this->assertSame( 'unavailable', $summary['state'] );
		$this->assertNull( $summary['total'] );
		$this->assertNull( $summary['series_pass_revenue'] );
		$this->assertSame( array(), $summary['daily'] );
	}

	/**
	 * Nothing sold is zero revenue that is available (example 1).
	 *
	 * @return void
	 */
	public function test_no_paid_links_is_available_zero(): void {
		$summary = PurchasePaymentHistory::summarize( array(), array(), 'EUR', true );

		$this->assertSame( 'available', $summary['state'] );
		$this->assertSame( 0.0, $summary['total'] );
		$this->assertSame( 0, $summary['unresolved'] );
	}

	/**
	 * Allocations are summed in cents per day of the attempt's creation;
	 * other currencies are listed, not converted, and a shared
	 * transaction counts only this date's allocation (examples 7 and 9).
	 *
	 * @return void
	 */
	public function test_allocations_sum_per_day_and_exclude_other_currencies(): void {
		$summary = PurchasePaymentHistory::summarize(
			array(
				self::link( 10, '12.00', 'EUR', '2026-10-01 09:00:00' ),
				self::link( 11, '30.00', 'EUR', '2026-10-01 18:00:00' ),
				self::link( 12, '30.00', 'EUR', '2026-10-03 08:00:00' ),
				self::link( 13, '0.10', 'EUR', '2026-10-03 08:00:00' ),
				self::link( 14, '0.20', 'EUR', '2026-10-03 08:00:00' ),
				self::link( 15, '50.00', 'usd', '2026-10-02 08:00:00' ),
			),
			array(),
			'EUR',
			true
		);

		$this->assertSame( 'available', $summary['state'] );
		$this->assertSame( 72.3, $summary['total'] );
		$this->assertSame(
			array(
				'2026-10-01' => 42.0,
				'2026-10-03' => 30.3,
			),
			$summary['daily']
		);
		$this->assertSame( array( 'USD' ), $summary['excluded_currencies'] );
	}

	/**
	 * An unallocated remainder or unresolved money for the date makes the
	 * allocated total incomplete, counting each payment once (examples 11,
	 * 14 and 21).
	 *
	 * @return void
	 */
	public function test_unresolved_money_makes_revenue_incomplete(): void {
		$summary = PurchasePaymentHistory::summarize(
			array( self::link( 20, '12.00', 'EUR', '2026-10-01 09:00:00' ) ),
			array(
				'remainder'  => array( 20 => true ),
				'unresolved' => array(
					'transaction:20' => true,
					'transaction:21' => true,
				),
			),
			'EUR',
			true
		);

		$this->assertSame( 'incomplete', $summary['state'] );
		$this->assertSame( 12.0, $summary['total'] );
		$this->assertSame( 2, $summary['unresolved'] );
	}

	/**
	 * Covering pass revenue on an occurrence is reported apart and never
	 * added to its total (§7.2, example 12).
	 *
	 * @return void
	 */
	public function test_series_pass_revenue_is_separate_from_the_total(): void {
		$summary = PurchasePaymentHistory::summarize(
			array( self::link( 30, '15.00', 'EUR', '2026-10-01 09:00:00' ) ),
			array(
				'series' => array(
					self::link( 31, '20.00', 'EUR', '2026-09-01 09:00:00' ),
					self::link( 32, '60.00', 'EUR', '2026-09-10 09:00:00' ),
				),
			),
			'EUR',
			true
		);

		$this->assertSame( 15.0, $summary['total'] );
		$this->assertSame( 80.0, $summary['series_pass_revenue'] );

		$master = PurchasePaymentHistory::summarize( array(), array( 'series' => null ), 'EUR', true );
		$this->assertNull( $master['series_pass_revenue'] );
	}

	/**
	 * Only paid links count, and a preserved refund-labelled record never
	 * does (§11, example 22).
	 *
	 * @return void
	 */
	public function test_only_paid_non_refund_records_count(): void {
		$this->assertTrue( PurchasePaymentHistory::counts_as_revenue( 'charge', 'paid' ) );
		$this->assertTrue( PurchasePaymentHistory::counts_as_revenue( 'additional_charge', 'paid' ) );
		$this->assertTrue( PurchasePaymentHistory::counts_as_revenue( 'upgrade', 'paid' ) );
		$this->assertFalse( PurchasePaymentHistory::counts_as_revenue( 'legacy_refund_record', 'paid' ) );
		$this->assertFalse( PurchasePaymentHistory::counts_as_revenue( 'charge', 'failed' ) );
		$this->assertFalse( PurchasePaymentHistory::counts_as_revenue( 'charge', 'refunded' ) );
	}

	/**
	 * What a purchase has paid sums only the allocations that count as
	 * revenue, in the requested currency, in cents (§5.2, §8.15): a failed
	 * attempt, a refund-labelled record and another currency don't add.
	 * Every paid attempt does (example 9).
	 *
	 * @return void
	 */
	public function test_paid_amount_sums_counted_allocations_in_one_currency(): void {
		$payments = array(
			array(
				'allocated_amount'  => 30.0,
				'currency'          => 'EUR',
				'counts_as_revenue' => false,
			),
			array(
				'allocated_amount'  => 0.1,
				'currency'          => 'eur',
				'counts_as_revenue' => true,
			),
			array(
				'allocated_amount'  => 0.2,
				'currency'          => 'EUR',
				'counts_as_revenue' => true,
			),
			array(
				'allocated_amount'  => 12.0,
				'currency'          => 'USD',
				'counts_as_revenue' => true,
			),
		);

		$this->assertSame( 0.3, PurchasePaymentHistory::paid_amount( $payments, 'EUR' ) );
		$this->assertSame( 12.0, PurchasePaymentHistory::paid_amount( $payments, 'usd' ) );
		$this->assertSame( 0.0, PurchasePaymentHistory::paid_amount( array(), 'EUR' ) );
	}

	/**
	 * A paid link row.
	 *
	 * @param int    $transaction_id Transaction ID.
	 * @param string $amount         Allocation.
	 * @param string $currency       Currency.
	 * @param string $created_at     Attempt creation.
	 * @return array
	 */
	private static function link( $transaction_id, $amount, $currency, $created_at ) {
		return array(
			'transaction_id'   => $transaction_id,
			'signup_id'        => 1,
			'allocated_amount' => $amount,
			'currency'         => $currency,
			'created_at'       => $created_at,
		);
	}
}
