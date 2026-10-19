<?php
/**
 * Allocation planning regressions.
 *
 * @package FairFinance
 */

namespace FairFinance\Tests\Services;

use FairFinance\Services\AllocationPlanner as Planner;
use PHPUnit\Framework\TestCase;

/**
 * Exercise the shared planner with no database, resolver or floats.
 */
class AllocationPlannerTest extends TestCase {
	/**
	 * Unclassified bank entry.
	 *
	 * @param string $amount Amount.
	 * @param array  $extra Extra columns.
	 * @return array
	 */
	private function entry( $amount, array $extra = array() ) {
		return array_merge(
			array(
				'id'              => 8,
				'amount'          => $amount,
				'parent_entry_id' => null,
				'budget_id'       => null,
				'event_url'       => null,
				'event_date_id'   => null,
				'tag'             => null,
				'participant_id'  => null,
			),
			$extra
		);
	}

	/**
	 * Evidence row for a local transaction without event or site links.
	 *
	 * @param string $amount Amount.
	 * @param int    $id Transaction ID.
	 * @return array
	 */
	private function payment( $amount, $id ) {
		return array(
			'kind'        => 'transaction',
			'amount'      => $amount,
			'description' => 'Ticket ' . $id,
			'transaction' => array(
				'id'            => $id,
				'event_date_id' => null,
				'metadata'      => null,
			),
		);
	}

	/**
	 * Settlement-level fee row.
	 *
	 * @param string $amount Amount.
	 * @return array
	 */
	private function fee( $amount ) {
		return array(
			'kind'        => 'settlement',
			'amount'      => $amount,
			'description' => 'Fees',
		);
	}

	/** Amounts Finance can store exactly, and only those. */
	public function test_cents_accepts_only_whole_cents() {
		$this->assertSame( '25.00', Planner::cents( '25' ) );
		$this->assertSame( '-1.45', Planner::cents( '-1.4500' ) );
		$this->assertSame( '0.00', Planner::cents( '-0.000' ) );
		$this->assertNull( Planner::cents( '0.725' ) );
		$this->assertNull( Planner::cents( '123456789.00' ) );
		$this->assertNull( Planner::cents( null ) );
	}

	/** Recorded fees are subtracted exactly, without floats. */
	public function test_net_subtracts_recorded_fees() {
		$this->assertSame(
			'24.10',
			Planner::net(
				array(
					'amount'          => '25.00',
					'application_fee' => '0.61',
					'mollie_fee'      => '0.29',
				)
			)
		);
		$this->assertSame(
			'15.00',
			Planner::net(
				array(
					'amount'          => '15.00',
					'application_fee' => null,
					'mollie_fee'      => null,
				)
			)
		);
	}

	/** Settlement-level fees become signed rows that sum exactly. */
	public function test_settlement_fees_complete_an_exact_split() {
		$plan = ( new Planner() )->plan( $this->entry( '38.55' ), array(), array( $this->payment( '25.00', 1 ), $this->payment( '15.00', 2 ), $this->fee( '-1.45' ) ), 'settlement_deductions' );
		$this->assertSame( Planner::PROPOSED, $plan['status'] );
		$this->assertSame( array( '25.00', '15.00', '-1.45' ), array_column( $plan['rows'], 'amount' ) );
		$this->assertSame( array( 1, 2, null ), array_column( $plan['rows'], 'transaction_id' ) );
	}

	/** An unexplained difference is never balanced or prorated. */
	public function test_unexplained_difference_is_unsupported() {
		$plan = ( new Planner() )->plan( $this->entry( '38.55' ), array(), array( $this->payment( '25.00', 1 ), $this->payment( '15.00', 2 ) ), 'transaction_net' );
		$this->assertSame( Planner::UNSUPPORTED, $plan['status'] );
		$this->assertSame( array(), $plan['rows'] );
		$this->assertStringContainsString( '40.00', $plan['reason'] );
	}

	/** Fractions of a cent are refused rather than rounded. */
	public function test_fractional_cents_are_unsupported() {
		$plan = ( new Planner() )->plan( $this->entry( '38.55' ), array(), array( $this->payment( '25.00', 1 ), $this->payment( '15.00', 2 ), $this->fee( '-0.725' ), $this->fee( '-0.725' ) ), 'settlement_deductions' );
		$this->assertSame( Planner::UNSUPPORTED, $plan['status'] );
	}

	/** One explaining transaction links the entry without a one-child split. */
	public function test_single_transaction_needs_no_split() {
		$plan = ( new Planner() )->plan( $this->entry( '25.00' ), array(), array( $this->payment( '25.00', 1 ) ), 'transaction_net' );
		$this->assertSame( Planner::SINGLE, $plan['status'] );
		$this->assertFalse( $plan['supported'] );
		$this->assertCount( 1, $plan['rows'] );
	}

	/** Existing allocations and classification are preserved. */
	public function test_existing_allocations_and_classification_are_kept() {
		$rows = array( $this->payment( '25.00', 1 ), $this->payment( '15.00', 2 ) );
		$this->assertSame( Planner::ALLOCATED, ( new Planner() )->plan( $this->entry( '40.00' ), array( array( 'id' => 9 ) ), $rows, 'transaction_net' )['status'] );
		$this->assertSame( Planner::UNSUPPORTED, ( new Planner() )->plan( $this->entry( '40.00', array( 'tag' => 'Kept' ) ), array(), $rows, 'transaction_net' )['status'] );
		$this->assertSame( Planner::UNSUPPORTED, ( new Planner() )->plan( $this->entry( '40.00', array( 'parent_entry_id' => 3 ) ), array(), $rows, 'transaction_net' )['status'] );
	}
}
