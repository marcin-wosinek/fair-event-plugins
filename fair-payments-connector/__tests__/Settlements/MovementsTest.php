<?php
/**
 * Movement identity, totals and cross-source comparison.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Settlements;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Settlements\Movements;

/**
 * Unit tests for Movements.
 */
class MovementsTest extends TestCase {

	/**
	 * Build a detail movement with an identity.
	 *
	 * @param string      $type      Movement type.
	 * @param string      $id        External reference.
	 * @param string|null $settled   Settlement amount.
	 * @param array       $overrides Other fields.
	 * @return array
	 */
	private function detail( $type, $id, $settled, array $overrides = array() ) {
		$movement = Movements::make(
			array_merge(
				array(
					'type'                => $type,
					'external_id'         => $id,
					'amount'              => $settled,
					'currency'            => 'EUR',
					'settlement_amount'   => $settled,
					'settlement_currency' => null === $settled ? null : 'EUR',
				),
				$overrides
			)
		);

		return Movements::assign_identities( array( $movement ) )[0];
	}

	/**
	 * Build an aggregate row with an identity.
	 *
	 * @param string $description Description.
	 * @param string $settled     Settlement amount.
	 * @return array
	 */
	private function aggregate( $description, $settled ) {
		return Movements::assign_identities(
			array(
				Movements::make(
					array(
						'type'                => Movements::TYPE_FEE,
						'is_aggregate'        => true,
						'description'         => $description,
						'settlement_amount'   => $settled,
						'settlement_currency' => 'EUR',
					)
				),
			)
		)[0];
	}

	/** A movement both sources report becomes one row and is not added twice. */
	public function test_merge_converges_movements_with_established_identity() {
		$merged = Movements::merge(
			array( $this->detail( Movements::TYPE_PAYMENT, 'tr_1', '10.00' ) ),
			array( $this->detail( Movements::TYPE_PAYMENT, 'tr_1', '10.00' ) )
		);

		$this->assertCount( 1, $merged );
		$this->assertSame( array( 'api', 'csv' ), $merged[0]['sources'] );
		$this->assertNull( $merged[0]['conflict'] );
	}

	/** Differing values are kept side by side, with the API value shown. */
	public function test_merge_keeps_contradictory_values_visible() {
		$merged = Movements::merge(
			array( $this->detail( Movements::TYPE_PAYMENT, 'tr_1', '10.00' ) ),
			array( $this->detail( Movements::TYPE_PAYMENT, 'tr_1', '9.50' ) )
		);

		$this->assertCount( 1, $merged );
		$this->assertSame( '10.00', $merged[0]['settlement_amount'] );
		$this->assertSame(
			array(
				'api' => '10.00',
				'csv' => '9.50',
			),
			$merged[0]['conflict']['settlement_amount']
		);
	}

	/** A value one source does not know is not a conflict. */
	public function test_merge_treats_unknown_as_no_conflict() {
		$merged = Movements::merge(
			array( $this->detail( Movements::TYPE_PAYMENT, 'tr_1', '10.00' ) ),
			array( $this->detail( Movements::TYPE_PAYMENT, 'tr_1', null ) )
		);

		$this->assertNull( $merged[0]['conflict'] );
	}

	/** Aggregate rows have no shared identity, so each source keeps its own. */
	public function test_merge_never_matches_aggregate_rows() {
		$merged = Movements::merge(
			array( $this->aggregate( 'Transaction fees', '-1.00' ) ),
			array( $this->aggregate( 'Transaction fees', '-1.00' ) )
		);

		$this->assertCount( 2, $merged );
		$this->assertSame( array( 'api' ), $merged[0]['sources'] );
		$this->assertSame( array( 'csv' ), $merged[1]['sources'] );
	}

	/** Movements only one source knows stay separate rows. */
	public function test_merge_keeps_single_source_movements() {
		$merged = Movements::merge(
			array( $this->detail( Movements::TYPE_REFUND, 're_1', '-5.00' ) ),
			array( $this->detail( Movements::TYPE_REFUND, 'tr_1', '-5.00' ) )
		);

		$this->assertCount( 2, $merged );
	}

	/** A payment settled through its captures is not counted on top of them. */
	public function test_totals_do_not_count_a_payment_and_its_captures_twice() {
		$totals = Movements::totals(
			array(
				$this->detail( Movements::TYPE_PAYMENT, 'tr_captured', '30.00' ),
				$this->detail( Movements::TYPE_CAPTURE, 'cpt_1', '20.00', array( 'payment_reference' => 'tr_captured' ) ),
				$this->detail( Movements::TYPE_CAPTURE, 'cpt_2', '10.00', array( 'payment_reference' => 'tr_captured' ) ),
				$this->detail( Movements::TYPE_PAYMENT, 'tr_plain', '5.00' ),
			)
		);

		$this->assertSame( '35.00', $totals['detail']['settlement_amount'] );
		$this->assertSame( 1, $totals['payments_settled_by_captures'] );
		$this->assertSame( 2, $totals['by_type'][ Movements::TYPE_PAYMENT ]['count'] );
	}

	/** A total over more than one currency cannot be stated. */
	public function test_totals_are_unknown_across_currencies() {
		$totals = Movements::totals(
			array(
				$this->detail( Movements::TYPE_PAYMENT, 'tr_1', '5.00' ),
				$this->detail( Movements::TYPE_PAYMENT, 'tr_2', '5.00', array( 'settlement_currency' => 'USD' ) ),
			)
		);

		$this->assertNull( $totals['detail']['settlement_amount'] );
		$this->assertNull( $totals['detail']['currency'] );
	}

	/** Report summaries are never part of a movement total. */
	public function test_totals_leave_report_summaries_out() {
		$summary = Movements::assign_identities(
			array(
				Movements::make(
					array(
						'type'                => Movements::TYPE_SUMMARY,
						'is_aggregate'        => true,
						'description'         => 'iDEAL',
						'settlement_amount'   => '100.00',
						'settlement_currency' => 'EUR',
					)
				),
			)
		);

		$totals = Movements::totals( array_merge( $summary, array( $this->aggregate( 'Fees', '-1.00' ) ) ) );

		$this->assertSame( '-1.00', $totals['aggregate']['settlement_amount'] );
		$this->assertSame( '100.00', $totals['by_type'][ Movements::TYPE_SUMMARY ]['settlement_amount'] );
	}

	/** The hash ignores order and wording but not money or status. */
	public function test_content_hash_reflects_material_facts_only() {
		$facts = array(
			'provider_id' => 'stl_1',
			'reference'   => 'REF.1',
			'currency'    => 'EUR',
			'amount'      => '15.00',
			'status'      => 'paidout',
			'settled_at'  => '2026-05-01 00:00:00',
		);
		$a     = $this->detail( Movements::TYPE_PAYMENT, 'tr_1', '10.00' );
		$b     = $this->detail( Movements::TYPE_PAYMENT, 'tr_2', '5.00' );
		$hash  = Movements::content_hash( $facts, array( $a, $b ) );

		$this->assertSame( $hash, Movements::content_hash( $facts, array( $b, $a ) ) );
		$this->assertSame( $hash, Movements::content_hash( $facts, array( array_merge( $a, array( 'description' => 'Renamed' ) ), $b ) ) );
		$this->assertNotSame( $hash, Movements::content_hash( array_merge( $facts, array( 'status' => 'failed' ) ), array( $a, $b ) ) );
		$this->assertNotSame( $hash, Movements::content_hash( $facts, array( $a ) ) );
		$this->assertNotSame( $hash, Movements::content_hash( $facts, array( array_merge( $a, array( 'settlement_amount' => '9.99' ) ), $b ) ) );
	}

	/** A proposed version is described by what it adds, removes and changes. */
	public function test_diff_lists_added_removed_and_changed() {
		$diff = Movements::diff(
			array(
				$this->detail( Movements::TYPE_PAYMENT, 'tr_kept', '10.00' ),
				$this->detail( Movements::TYPE_PAYMENT, 'tr_changed', '10.00' ),
				$this->detail( Movements::TYPE_PAYMENT, 'tr_removed', '10.00' ),
			),
			array(
				$this->detail( Movements::TYPE_PAYMENT, 'tr_kept', '10.00' ),
				$this->detail( Movements::TYPE_PAYMENT, 'tr_changed', '12.00' ),
				$this->detail( Movements::TYPE_PAYMENT, 'tr_added', '3.00' ),
			)
		);

		$this->assertSame( array( 'tr_added' ), array_column( $diff['added'], 'external_id' ) );
		$this->assertSame( array( 'tr_removed' ), array_column( $diff['removed'], 'external_id' ) );
		$this->assertCount( 1, $diff['changed'] );
		$this->assertSame( 'tr_changed', $diff['changed'][0]['external_id'] );
		$this->assertSame( '12.00', $diff['changed'][0]['fields']['settlement_amount']['proposed'] );
	}
}
