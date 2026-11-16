<?php
/**
 * Exact payout explanation regressions.
 *
 * @package FairFinance
 */

namespace FairFinance\Tests\Services;

use FairFinance\Services\SettlementReconciliation as Reconciliation;
use FairPaymentsConnector\Settlements\Movements;
use FairPaymentsConnector\Settlements\Report;
use PHPUnit\Framework\TestCase;

/**
 * Exercise financial rules with no provider, database or floats.
 */
class SettlementReconciliationTest extends TestCase {
	/**
	 * Build supported fixture movements.
	 *
	 * @param string      $type Movement type.
	 * @param string|null $amount Settlement amount.
	 * @param array       $extra Extra fields.
	 * @return array
	 */
	private function movement( $type, $amount, array $extra = array() ) {
		return Movements::make(
			array_merge(
				array(
					'type'                => $type,
					'settlement_amount'   => $amount,
					'settlement_currency' => 'EUR',
				),
				$extra
			)
		);
	}

	/** Payment and capture membership are separate but never counted twice. */
	public function test_capture_supersedes_payment_principal() {
		$result = Reconciliation::explain(
			array(
				$this->movement( 'payment', '40.00', array( 'external_id' => 'tr_parent' ) ),
				$this->movement( 'capture', '25.00', array( 'payment_reference' => 'tr_parent' ) ),
				$this->movement( 'capture', '15.00', array( 'payment_reference' => 'tr_parent' ) ),
				$this->movement( 'fee', '-1.45', array( 'is_aggregate' => true ) ),
			),
			'EUR'
		);
		$this->assertSame( '38.55', $result['net'] );
		$this->assertSame( array(), $result['issues'] );
	}

	/** Aggregate fees never add to their constituent details. */
	public function test_aggregate_and_detail_are_alternatives() {
		$result = Reconciliation::explain(
			array(
				$this->movement( 'payment', '10.00' ),
				$this->movement( 'fee', '-0.25' ),
				$this->movement( 'fee', '-0.75' ),
				$this->movement( 'fee', '-1.00', array( 'is_aggregate' => true ) ),
			),
			'EUR'
		);
		$this->assertSame( '9.00', $result['net'] );
		$this->assertSame( array(), $result['issues'] );
	}

	/** Disagreeing aggregates remain blocking. */
	public function test_incompatible_aggregate_is_unresolved() {
		$result = Reconciliation::explain( array( $this->movement( 'fee', '-0.25' ), $this->movement( 'fee', '-1.00', array( 'is_aggregate' => true ) ) ), 'EUR' );
		$this->assertNotEmpty( $result['issues'] );
	}

	/** Refund and chargeback retain the supplied signed settlement amount. */
	public function test_later_refunds_chargebacks_and_fx() {
		$result = Reconciliation::explain(
			array(
				$this->movement(
					'payment',
					'50.00',
					array(
						'amount'   => '60.00',
						'currency' => 'USD',
					)
				),
				$this->movement( 'refund', '-10.00' ),
				$this->movement( 'chargeback', '-5.00' ),
			),
			'EUR'
		);
		$this->assertSame( '35.00', $result['net'] );
		$this->assertSame( array(), $result['issues'] );
	}

	/** Unknown amounts and currencies must not turn into zero. */
	public function test_unknowns_block_even_when_known_lines_add_up() {
		foreach ( array( $this->movement( 'unknown', '0.00' ), $this->movement( 'fee', null ), $this->movement( 'fee', '0.00', array( 'settlement_currency' => 'USD' ) ) ) as $unknown ) {
			$result = Reconciliation::explain( array( $this->movement( 'payment', '10.00' ), $unknown ), 'EUR' );
			$this->assertNotEmpty( $result['issues'] );
		}
	}

	/** Report precision and explicit rounding survive the payout check. */
	public function test_fractional_cent_report_and_rounding() {
		$money = static function ( $value ) {
			return array(
				'value'    => $value,
				'currency' => 'EUR',
			);
		};
		$items = array( $this->movement( 'payment', '40.00' ) );
		foreach ( array( array( 'revenue', '40.00' ), array( 'costs', '3.9045' ), array( 'costs', '-0.0045' ) ) as $pair ) {
			$items[] = $this->movement(
				'summary',
				null,
				array(
					'is_aggregate' => true,
					'report'       => Report::line( '2026', '05', $pair[0], array( 'amountGross' => $money( $pair[1] ) ) ),
				)
			);
		}
		$result = Reconciliation::explain( $items, 'EUR' );
		$this->assertSame( '36.1000', $result['net'] );
		$this->assertSame( array(), $result['issues'] );
		$items[0]['settlement_amount'] = '39.00';
		$this->assertNotEmpty( Reconciliation::explain( $items, 'EUR' )['issues'] );
	}

	/**
	 * A report line movement as the Mollie provider stores it.
	 *
	 * @param string      $group Report group.
	 * @param string      $gross Gross amount as Mollie states it.
	 * @param string|null $method Payment method.
	 * @param string      $description Line description.
	 * @return array
	 */
	private function report_line( $group, $gross, $method, $description = '' ) {
		$report = Report::line(
			'2026',
			'05',
			$group,
			array(
				'method'      => $method,
				'amountGross' => array(
					'value'    => $gross,
					'currency' => 'EUR',
				),
			)
		);
		return $this->movement(
			'costs' === $group ? 'fee' : 'summary',
			Report::contribution( $report )['value'],
			array(
				'is_aggregate' => true,
				'description'  => $description,
				'identity_key' => 'report:' . $group . ':' . $gross,
				'report'       => $report,
			)
		);
	}

	/**
	 * The reported settlement: €825.00 in payments, €15.35 in payment fees and
	 * a €0.02 invoice compensation, paid out as €809.67.
	 *
	 * @return array
	 */
	private function compensated_items() {
		return array(
			$this->movement( 'payment', '500.00', array( 'external_id' => 'tr_a' ) ),
			$this->movement( 'payment', '325.00', array( 'external_id' => 'tr_b' ) ),
			$this->report_line( 'revenue', '825.00', 'ideal' ),
			$this->report_line( 'costs', '15.35', 'ideal', 'iDEAL' ),
			$this->report_line( 'costs', '-0.02', null, 'Invoice compensation' ),
		);
	}

	/**
	 * Whole payments with recorded fees.
	 *
	 * @param array $fees Recorded fee per payment, null when missing.
	 * @return array
	 */
	private function payments( array $fees = array( '10.00', '5.35' ) ) {
		$rows = array();
		foreach ( array( '500.00', '325.00' ) as $index => $gross ) {
			$fee    = $fees[ $index ];
			$rows[] = array(
				'gross'    => $gross,
				'net'      => null === $fee ? $gross : \FairPaymentsConnector\Settlements\ReportDecimal::subtract( $gross, $fee ),
				'recorded' => null !== $fee,
			);
		}
		return $rows;
	}

	/** Compensation is its own row; recorded payment fees are not deducted again. */
	public function test_compensation_keeps_net_payments() {
		$items       = $this->compensated_items();
		$explanation = Reconciliation::explain( $items, 'EUR' );
		$this->assertSame( array(), $explanation['issues'] );
		$this->assertSame( '809.67', $explanation['net'] );
		$rows = Reconciliation::net_adjustments( $this->payments(), $items, $explanation, 'EUR' );
		$this->assertSame(
			array(
				array(
					'kind'         => 'settlement',
					'amount'       => '0.02',
					'description'  => 'Invoice compensation',
					'movement_key' => 'report:costs:-0.02',
				),
			),
			$rows
		);
		// 490.00 + 319.65 net payments plus the compensation equal the payout.
		$this->assertSame( '809.67', \FairPaymentsConnector\Settlements\ReportDecimal::sum( array( '490.00', '319.65', $rows[0]['amount'] ) ) );
	}

	/** Fees that disagree with the settlement evidence are explained, never deducted twice. */
	public function test_disagreeing_fees_are_not_charged_twice() {
		$items       = $this->compensated_items();
		$explanation = Reconciliation::explain( $items, 'EUR' );
		$reason      = Reconciliation::net_adjustments( $this->payments( array( '10.00', '5.33' ) ), $items, $explanation, 'EUR' );
		$this->assertIsString( $reason );
		$this->assertStringContainsString( '15.33', $reason );
		$this->assertStringContainsString( '15.35', $reason );
	}

	/** A missing recorded fee is explained instead of guessed. */
	public function test_missing_fee_is_explained() {
		$items  = $this->compensated_items();
		$reason = Reconciliation::net_adjustments( $this->payments( array( '10.00', null ) ), $items, Reconciliation::explain( $items, 'EUR' ), 'EUR' );
		$this->assertIsString( $reason );
		$this->assertStringContainsString( 'no recorded Mollie fee', $reason );
	}

	/** Without an evidenced adjustment, a remaining difference is never balanced. */
	public function test_unexplained_difference_invents_nothing() {
		$items = $this->compensated_items();
		array_pop( $items );
		$reason = Reconciliation::net_adjustments( $this->payments(), $items, Reconciliation::explain( $items, 'EUR' ), 'EUR' );
		$this->assertIsString( $reason );
		$this->assertStringContainsString( 'no settlement adjustment', $reason );
	}

	/** Mollie's refund cost line is a settlement cost, not a payment fee. */
	public function test_refund_cost_line_is_an_adjustment() {
		$items   = $this->compensated_items();
		$items[] = $this->report_line( 'costs', '0.25', 'refund', 'Refunds iDEAL' );
		$rows    = Reconciliation::net_adjustments( $this->payments(), $items, Reconciliation::explain( $items, 'EUR' ), 'EUR' );
		$this->assertSame( array( '0.02', '-0.25' ), array_column( $rows, 'amount' ) );
	}

	/** Without a report, the movement type separates fees from adjustments. */
	public function test_movement_fees_and_adjustments() {
		$items = array(
			$this->movement( 'fee', '-15.35', array( 'is_aggregate' => true ) ),
			$this->movement(
				'adjustment',
				'0.02',
				array(
					'description'  => 'Compensation',
					'identity_key' => 'adjustment#1',
				)
			),
		);
		$rows  = Reconciliation::net_adjustments( $this->payments(), $items, array( 'report' => null ), 'EUR' );
		$this->assertSame( array( '0.02' ), array_column( $rows, 'amount' ) );
		$items[0]['settlement_amount'] = '-15.00';
		$this->assertIsString( Reconciliation::net_adjustments( $this->payments(), $items, array( 'report' => null ), 'EUR' ) );
	}

	/** Fractional-cent adjustments are combined only into whole cents. */
	public function test_fractional_adjustments() {
		$items   = $this->compensated_items();
		$items[] = $this->report_line( 'costs', '-0.0045', null, 'Rounding difference' );
		$this->assertIsString( Reconciliation::net_adjustments( $this->payments(), $items, Reconciliation::explain( $items, 'EUR' ), 'EUR' ) );
		$items[] = $this->report_line( 'costs', '0.0045', null, 'Rounding difference' );
		$rows    = Reconciliation::net_adjustments( $this->payments(), $items, Reconciliation::explain( $items, 'EUR' ), 'EUR' );
		$this->assertCount( 1, $rows );
		$this->assertSame( '0.02', \FairFinance\Services\AllocationPlanner::cents( $rows[0]['amount'] ) );
	}

	/**
	 * A saved settlement row for scoring.
	 *
	 * @param array $extra Overrides.
	 * @return array
	 */
	private function settlement( array $extra = array() ) {
		return array_merge(
			array(
				'reference'  => 'PAY.2605.01',
				'account_id' => 3,
				'currency'   => 'EUR',
				'settled_at' => '2026-05-02 00:00:00',
			),
			$extra
		);
	}

	/**
	 * A bank entry row with its confirmed context columns.
	 *
	 * @param array $extra Overrides.
	 * @return array
	 */
	private function entry( array $extra = array() ) {
		return array_merge(
			array(
				'description'        => 'TRF. STICHTING MOLLIE PAYMENTS pay.2605.01',
				'amount'             => '38.55',
				'entry_date'         => '2026-05-04',
				'context_account_id' => null,
				'context_currency'   => null,
			),
			$extra
		);
	}

	/** Reference, exact amount and date are separate, visible evidence. */
	public function test_score_explains_reference_amount_and_date() {
		$result = Reconciliation::score( $this->settlement(), '38.55', $this->entry() );
		$this->assertSame( 13, $result['score'] );
		$this->assertCount( 3, $result['reasons'] );
		$this->assertFalse( $result['context_mismatch'] );
	}

	/** Amounts compare exactly, and a distant date adds nothing. */
	public function test_score_requires_exact_amount_and_near_date() {
		$result = Reconciliation::score( $this->settlement( array( 'reference' => 'OTHER' ) ), '38.56', $this->entry( array( 'entry_date' => '2026-06-01' ) ) );
		$this->assertSame( 0, $result['score'] );
		$this->assertSame( array(), $result['reasons'] );
	}

	/** An unknown CSV-only payout amount never matches by amount. */
	public function test_score_with_unknown_amount() {
		$result = Reconciliation::score( $this->settlement( array( 'reference' => null ) ), null, $this->entry() );
		$this->assertSame( 1, $result['score'] );
	}

	/** Confirmed context adds evidence when it agrees and flags a conflict otherwise. */
	public function test_score_confirmed_context() {
		$agrees = Reconciliation::score(
			$this->settlement(),
			'38.55',
			$this->entry(
				array(
					'context_account_id' => '3',
					'context_currency'   => 'EUR',
				)
			)
		);
		$this->assertSame( 19, $agrees['score'] );
		$this->assertFalse( $agrees['context_mismatch'] );
		$conflict = Reconciliation::score(
			$this->settlement(),
			'38.55',
			$this->entry(
				array(
					'context_account_id' => '4',
					'context_currency'   => 'USD',
				)
			)
		);
		$this->assertSame( 13, $conflict['score'] );
		$this->assertTrue( $conflict['context_mismatch'] );
	}
}
