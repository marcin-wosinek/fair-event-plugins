<?php
/**
 * Event finance summary calculation tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\EventFinanceSummary;
use PHPUnit\Framework\TestCase;

/**
 * Covers #2398: headline figures, fee allocation of shared payments,
 * missing data and payout states.
 */
class EventFinanceSummaryTest extends TestCase {

	/**
	 * A transaction belonging to the date in full.
	 *
	 * @param int      $total      Cents.
	 * @param int|null $mollie_fee Cents.
	 * @param string   $payout     Payout state.
	 * @return array
	 */
	private static function own( $total, $mollie_fee, $payout = EventFinanceSummary::PAYOUT_UNKNOWN ) {
		return array(
			'transaction_id'  => $total,
			'total'           => $total,
			'mollie_fee'      => $mollie_fee,
			'application_fee' => 0,
			'shares'          => array(
				array(
					'amount' => $total,
					'own'    => true,
				),
			),
			'payout'          => $payout,
		);
	}

	/**
	 * Fair Finance's event summary.
	 *
	 * @param array $overrides Fields to replace.
	 * @return array
	 */
	private static function finance( array $overrides = array() ) {
		return $overrides + array(
			'currency'                 => 'EUR',
			'cash_income'              => 0,
			'event_cash_expenses'      => 0,
			'total_expenses'           => 0,
			'personally_paid'          => 0,
			'personally_paid_by_payer' => array(),
			'bank_paid_expenses'       => 0,
			'unclassified_expenses'    => 0,
		);
	}

	/**
	 * The Valencia example from the ticket.
	 *
	 * @param string $payout Payout state of every payment.
	 * @return array
	 */
	private static function valencia( $payout = EventFinanceSummary::PAYOUT_UNKNOWN ) {
		return EventFinanceSummary::calculate(
			array(
				'currency' => 'EUR',
				'online'   => array(
					'transactions' => array(
						self::own( 360000, 6250, $payout ),
						self::own( 1500, 31, $payout ),
					),
					'unallocated'  => 0,
				),
				'finance'  => self::finance(
					array(
						'cash_income'              => 335,
						'total_expenses'           => 277.97,
						'personally_paid'          => 277.97,
						'personally_paid_by_payer' => array(
							array(
								'payer_name' => 'Ana',
								'amount'     => 262.97,
							),
							array(
								'payer_name' => 'Sayli',
								'amount'     => 15,
							),
						),
					)
				),
			)
		);
	}

	/**
	 * The ticket example: €3,950.00 − €340.78 = €3,609.22.
	 *
	 * @return void
	 */
	public function test_valencia_figures_reconcile() {
		$summary = self::valencia();

		$this->assertSame( EventFinanceSummary::STATE_COMPLETE, $summary['state'] );
		$this->assertSame( 3950.0, $summary['sales']['total'] );
		$this->assertSame( 3615.0, $summary['sales']['online']['gross'] );
		$this->assertSame( 335.0, $summary['sales']['cash'] );
		$this->assertSame( 62.81, $summary['sales']['online']['mollie_fees'] );
		$this->assertSame( 0.0, $summary['sales']['online']['application_fees'] );
		$this->assertSame( 3552.19, $summary['sales']['online']['net'] );
		$this->assertSame( 340.78, $summary['costs']['total'] );
		$this->assertSame( 277.97, $summary['costs']['expenses']['total'] );
		$this->assertSame( 277.97, $summary['costs']['expenses']['personal'] );
		$this->assertSame( 0.0, $summary['costs']['expenses']['event_cash'] );
		$this->assertSame( 62.81, $summary['costs']['payment_fees'] );
		$this->assertSame( 3609.22, $summary['net_result'] );
		$this->assertSame( 'Sayli', $summary['costs']['expenses']['personal_by_payer'][1]['payer_name'] );
		$this->assertSame( 15.0, $summary['costs']['expenses']['personal_by_payer'][1]['amount'] );
	}

	/**
	 * A payout or bank receipt moves the net amount between states only.
	 *
	 * @return void
	 */
	public function test_payout_moves_net_amount_without_changing_result() {
		$unknown  = self::valencia();
		$awaiting = self::valencia( EventFinanceSummary::PAYOUT_AWAITING );
		$paid_out = self::valencia( EventFinanceSummary::PAYOUT_PAID_OUT );
		$received = self::valencia( EventFinanceSummary::PAYOUT_RECEIVED );

		$this->assertSame( 3552.19, $unknown['payout']['unknown'] );
		$this->assertSame( 0.0, $unknown['payout']['received_in_bank'] );
		$this->assertSame( 3552.19, $awaiting['payout']['awaiting_payout'] );
		$this->assertSame( 0.0, $awaiting['payout']['unknown'] );
		$this->assertSame( 3552.19, $paid_out['payout']['paid_out'] );
		// Bank receipt confirms a payout: counted once, not also as paid out.
		$this->assertSame( 3552.19, $received['payout']['received_in_bank'] );
		$this->assertSame( 0.0, $received['payout']['paid_out'] );

		foreach ( array( $awaiting, $paid_out, $received ) as $summary ) {
			$this->assertSame( $unknown['net_result'], $summary['net_result'] );
			$this->assertSame( $unknown['sales'], $summary['sales'] );
			$this->assertSame( $unknown['costs'], $summary['costs'] );
		}
	}

	/**
	 * A shared payment counts this date's share and its proportional fees.
	 *
	 * @return void
	 */
	public function test_shared_payment_counts_own_share_and_proportional_fee() {
		// One €100 payment for three purchases: €50 here, €30 and €20 elsewhere.
		$shared = array(
			'transaction_id'  => 9,
			'total'           => 10000,
			'mollie_fee'      => 101,
			'application_fee' => 7,
			'shares'          => array(
				array(
					'amount' => 3000,
					'own'    => false,
				),
				array(
					'amount' => 5000,
					'own'    => true,
				),
				array(
					'amount' => 2000,
					'own'    => false,
				),
			),
			'payout'          => EventFinanceSummary::PAYOUT_PAID_OUT,
		);

		$summary = EventFinanceSummary::calculate(
			array(
				'currency' => 'EUR',
				'online'   => array(
					'transactions' => array( $shared ),
					'unallocated'  => 0,
				),
				'finance'  => self::finance(),
			)
		);

		$this->assertSame( 50.0, $summary['sales']['online']['gross'] );
		// 1.01 × 50% = 0.505 → 0.51 by largest remainder; 0.07 × 50% → 0.04.
		$this->assertSame( 0.51, $summary['sales']['online']['mollie_fees'] );
		$this->assertSame( 0.04, $summary['sales']['online']['application_fees'] );
		$this->assertSame( 49.45, $summary['sales']['online']['net'] );
		$this->assertSame( 49.45, $summary['payout']['paid_out'] );
		$this->assertSame( 1, $summary['sales']['online']['payment_count'] );
	}

	/**
	 * Fee parts always add up to the fee, deterministically.
	 *
	 * @return void
	 */
	public function test_allocated_fees_add_up_exactly() {
		$parts = EventFinanceSummary::allocate( 100, array( 1, 1, 1 ) );
		$this->assertSame( array( 34, 33, 33 ), $parts );
		$this->assertSame( 100, array_sum( $parts ) );

		$parts = EventFinanceSummary::allocate( 6281, array( 1234, 0, 999, 4321 ) );
		$this->assertSame( 6281, array_sum( $parts ) );
		$this->assertSame( 0, $parts[1] );

		$this->assertSame( array( 0, 0 ), EventFinanceSummary::allocate( 50, array( 0, 0 ) ) );
		$this->assertSame( array( -34, -33, -33 ), EventFinanceSummary::allocate( -100, array( 1, 1, 1 ) ) );
	}

	/**
	 * An unallocated remainder keeps its fee share and marks the summary incomplete.
	 *
	 * @return void
	 */
	public function test_unallocated_remainder_carries_its_fee() {
		// €100 payment with only €60 allocated (to this date): €40 unallocated.
		$summary = EventFinanceSummary::calculate(
			array(
				'currency' => 'EUR',
				'online'   => array(
					'transactions' => array(
						array(
							'transaction_id'  => 1,
							'total'           => 10000,
							'mollie_fee'      => 100,
							'application_fee' => 0,
							'shares'          => array(
								array(
									'amount' => 6000,
									'own'    => true,
								),
							),
							'payout'          => EventFinanceSummary::PAYOUT_UNKNOWN,
						),
					),
					'unallocated'  => 1,
				),
				'finance'  => self::finance(),
			)
		);

		$this->assertSame( 60.0, $summary['sales']['online']['gross'] );
		$this->assertSame( 0.6, $summary['sales']['online']['fees'] );
		$this->assertSame( EventFinanceSummary::STATE_INCOMPLETE, $summary['state'] );
		$this->assertContains( EventFinanceSummary::ISSUE_ONLINE_UNALLOCATED, $summary['issues'] );
	}

	/**
	 * A missing Mollie fee makes the summary incomplete without guessing.
	 *
	 * @return void
	 */
	public function test_missing_fee_marks_summary_incomplete() {
		$summary = EventFinanceSummary::calculate(
			array(
				'currency' => 'EUR',
				'online'   => array(
					'transactions' => array(
						self::own( 2000, 50, EventFinanceSummary::PAYOUT_AWAITING ),
						self::own( 3000, null, EventFinanceSummary::PAYOUT_AWAITING ),
					),
					'unallocated'  => 0,
				),
				'finance'  => self::finance(),
			)
		);

		$this->assertSame( EventFinanceSummary::STATE_INCOMPLETE, $summary['state'] );
		$this->assertSame( array( EventFinanceSummary::ISSUE_FEES_MISSING ), $summary['issues'] );
		$this->assertFalse( $summary['sales']['online']['fees_complete'] );
		$this->assertSame( 50.0, $summary['sales']['online']['gross'] );
		$this->assertSame( 0.5, $summary['costs']['payment_fees'] );
		// The payment without a fee has no known net amount to place.
		$this->assertSame( 19.5, $summary['payout']['awaiting_payout'] );
		$this->assertSame( 1, $summary['payout']['unpriced_count'] );
	}

	/**
	 * Unreadable payments are null, never zero.
	 *
	 * @return void
	 */
	public function test_unavailable_payments_are_null_not_zero() {
		$summary = EventFinanceSummary::calculate(
			array(
				'currency' => 'EUR',
				'online'   => null,
				'finance'  => self::finance(
					array(
						'cash_income'           => 100,
						'total_expenses'        => 40,
						'unclassified_expenses' => 40,
					)
				),
			)
		);

		$this->assertSame( EventFinanceSummary::STATE_INCOMPLETE, $summary['state'] );
		$this->assertSame( array( EventFinanceSummary::ISSUE_ONLINE_UNAVAILABLE ), $summary['issues'] );
		$this->assertNull( $summary['sales']['online'] );
		$this->assertNull( $summary['costs']['payment_fees'] );
		$this->assertNull( $summary['payout'] );
		$this->assertSame( 100.0, $summary['sales']['total'] );
		$this->assertSame( 60.0, $summary['net_result'] );
	}

	/**
	 * An inactive or failed Fair Finance is null, never zero.
	 *
	 * @return void
	 */
	public function test_inactive_or_failed_finance_is_not_zero() {
		$online = array(
			'transactions' => array( self::own( 1000, 10 ) ),
			'unallocated'  => 0,
		);

		$inactive = EventFinanceSummary::calculate(
			array(
				'currency' => 'EUR',
				'online'   => $online,
				'finance'  => null,
			)
		);
		$this->assertSame( array( EventFinanceSummary::ISSUE_FINANCE_INACTIVE ), $inactive['issues'] );
		$this->assertNull( $inactive['costs']['expenses'] );
		$this->assertNull( $inactive['sales']['cash'] );
		$this->assertSame( 0.1, $inactive['costs']['total'] );

		$failed = EventFinanceSummary::calculate(
			array(
				'currency' => 'EUR',
				'online'   => $online,
				'finance'  => false,
			)
		);
		$this->assertSame( array( EventFinanceSummary::ISSUE_FINANCE_UNAVAILABLE ), $failed['issues'] );
		$this->assertNull( $failed['costs']['expenses'] );

		$nothing = EventFinanceSummary::calculate(
			array(
				'currency' => 'EUR',
				'online'   => null,
				'finance'  => false,
			)
		);
		$this->assertNull( $nothing['sales']['total'] );
		$this->assertNull( $nothing['costs']['total'] );
		$this->assertNull( $nothing['net_result'] );
	}

	/**
	 * Expense sources pass through; currency problems are named.
	 *
	 * @return void
	 */
	public function test_expense_sources_and_currency_mismatch() {
		$summary = EventFinanceSummary::calculate(
			array(
				'currency' => 'USD',
				'online'   => array(
					'transactions'   => array(),
					'unallocated'    => 0,
					'other_currency' => true,
				),
				'finance'  => self::finance(
					array(
						'total_expenses'        => 100,
						'event_cash_expenses'   => 10,
						'personally_paid'       => 20,
						'bank_paid_expenses'    => 30,
						'unclassified_expenses' => 40,
					)
				),
			)
		);

		$this->assertSame(
			array( EventFinanceSummary::ISSUE_OTHER_CURRENCY, EventFinanceSummary::ISSUE_CURRENCY_MISMATCH ),
			$summary['issues']
		);
		$this->assertSame( 30.0, $summary['costs']['expenses']['bank'] );
		$this->assertSame( 40.0, $summary['costs']['expenses']['unclassified'] );
		$this->assertSame( 0.0, $summary['sales']['online']['gross'] );
	}
}
