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
