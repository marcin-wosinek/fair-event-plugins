<?php
/**
 * Existing settlement split recalculation regressions.
 *
 * @package FairFinance
 */

namespace FairFinance\Tests\Services;

use FairFinance\Services\SplitRecalculation as Recalculation;
use PHPUnit\Framework\TestCase;

/**
 * Exercise row identity and categorization rules with no database.
 */
class SplitRecalculationTest extends TestCase {
	/**
	 * History as confirmation saved it: allocation IDs and the applied rows.
	 *
	 * @param array $rows Generated rows.
	 * @param array $ids Allocation IDs.
	 * @return array
	 */
	private function history( array $rows, array $ids = array( 11, 12, 13 ) ) {
		return array(
			array(
				'id'       => 1,
				'reviewed' => wp_json_encode( array( 'preview' => array() ) ),
			),
			array(
				'id'       => 2,
				'reviewed' => wp_json_encode(
					array(
						'allocation_ids' => $ids,
						'preview'        => array( 'allocation' => array( 'rows' => $rows ) ),
					)
				),
			),
		);
	}

	/**
	 * A planner row.
	 *
	 * @param string      $kind Kind.
	 * @param string      $amount Amount.
	 * @param string|null $key Movement key.
	 * @param int|null    $transaction Transaction ID.
	 * @param string      $description Description.
	 * @return array
	 */
	private function row( $kind, $amount, $key, $transaction = null, $description = '' ) {
		return array(
			'kind'           => $kind,
			'amount'         => $amount,
			'description'    => $description,
			'movement_key'   => $key,
			'transaction_id' => $transaction,
		);
	}

	/**
	 * Gross rows and a combined cost row, as created before this fix.
	 *
	 * @return array
	 */
	private function gross() {
		return array(
			$this->row( 'transaction', '500.00', 'payment:tr_a#1', 1, 'Ticket A' ),
			$this->row( 'transaction', '325.00', 'payment:tr_b#1', 2, 'Ticket B' ),
			$this->row( 'settlement', '-15.33', null, null, 'Mollie costs from the settlement report' ),
		);
	}

	/**
	 * Net rows and the compensation, as proposed now.
	 *
	 * @return array
	 */
	private function net() {
		return array(
			$this->row( 'transaction', '490.00', 'payment:tr_a#1', 1, 'Ticket A' ),
			$this->row( 'transaction', '319.65', 'payment:tr_b#1', 2, 'Ticket B' ),
			$this->row( 'settlement', '0.02', 'fee:report#1', null, 'Invoice compensation' ),
		);
	}

	/**
	 * Existing allocations, independently categorized.
	 *
	 * @return array
	 */
	private function children() {
		return array(
			array(
				'id'             => 11,
				'amount'         => '500.00',
				'description'    => 'Ticket A',
				'tag'            => 'workshop',
				'budget_id'      => '4',
				'event_url'      => 'https://example.test/a',
				'event_date_id'  => '7',
				'participant_id' => null,
			),
			array(
				'id'             => 12,
				'amount'         => '325.00',
				'description'    => 'Ticket B',
				// Intentionally untagged.
				'tag'            => null,
				'budget_id'      => null,
				'event_url'      => null,
				'event_date_id'  => null,
				'participant_id' => '9',
			),
			array(
				'id'             => 13,
				'amount'         => '-15.33',
				'description'    => 'Mollie costs from the settlement report',
				'tag'            => 'fees',
				'budget_id'      => '5',
				'event_url'      => null,
				'event_date_id'  => null,
				'participant_id' => null,
			),
		);
	}

	/** Payment rows are corrected in place, keeping every categorization field. */
	public function test_corrects_amounts_and_keeps_categorization() {
		$diff = Recalculation::diff( $this->children(), Recalculation::generated( $this->history( $this->gross() ) ), $this->net() );
		$this->assertSame( Recalculation::PROPOSED, $diff['status'] );
		$this->assertSame( array(), $diff['warnings'] );
		$by_id = array_column( $diff['changes'], null, 'id' );
		$this->assertSame( array( 11, 12, 13 ), array_keys( $by_id ) );
		$this->assertSame( '490.00', $by_id[11]['proposed_amount'] );
		$this->assertSame( 'workshop', $by_id[11]['tag'] );
		$this->assertSame( 4, $by_id[11]['budget_id'] );
		$this->assertSame( 'https://example.test/a', $by_id[11]['event_url'] );
		$this->assertSame( 7, $by_id[11]['event_date_id'] );
		$this->assertNull( $by_id[12]['tag'] );
		$this->assertSame( 9, $by_id[12]['participant_id'] );
		// The single cost row becomes the single adjustment, keeping its tag.
		$this->assertSame( Recalculation::UPDATE, $by_id[13]['action'] );
		$this->assertSame( '0.02', $by_id[13]['proposed_amount'] );
		$this->assertSame( 'fees', $by_id[13]['tag'] );
		$this->assertSame( 5, $by_id[13]['budget_id'] );
		$this->assertSame( 'Invoice compensation', $by_id[13]['new_description'] );
		$this->assertSame( 13, $by_id[13]['transferred_from'] );
	}

	/** Recalculating an already recalculated split changes nothing. */
	public function test_repeat_is_unchanged() {
		$children = $this->children();
		foreach ( array( '490.00', '319.65', '0.02' ) as $index => $amount ) {
			$children[ $index ]['amount'] = $amount;
		}
		$children[2]['description'] = 'Invoice compensation';
		$history                    = array(
			array(
				'id'       => 3,
				'reviewed' => wp_json_encode(
					array(
						'allocation_ids'  => array( 11, 12, 13 ),
						'allocation_rows' => $this->net(),
					)
				),
			),
		);
		$diff                       = Recalculation::diff( $children, Recalculation::generated( array_merge( $this->history( $this->gross() ), $history ) ), $this->net() );
		$this->assertSame( Recalculation::UNCHANGED, $diff['status'] );
	}

	/** Identity comes from saved IDs and movement keys, not row order. */
	public function test_row_order_is_irrelevant() {
		$diff = Recalculation::diff( array_reverse( $this->children() ), Recalculation::generated( $this->history( $this->gross() ) ), array_reverse( $this->net() ) );
		$this->assertSame( Recalculation::PROPOSED, $diff['status'] );
		$by_id = array_column( $diff['changes'], 'proposed_amount', 'id' );
		$this->assertSame( '490.00', $by_id[11] );
		$this->assertSame( '319.65', $by_id[12] );
	}

	/** A manually changed payment amount is reported before it is replaced. */
	public function test_manual_amount_is_warned() {
		$children              = $this->children();
		$children[0]['amount'] = '480.00';
		$children[2]['amount'] = '-5.33';
		$diff                  = Recalculation::diff( $children, Recalculation::generated( $this->history( $this->gross() ) ), $this->net() );
		$this->assertSame( Recalculation::PROPOSED, $diff['status'] );
		$this->assertCount( 2, $diff['warnings'] );
		$this->assertStringContainsString( '480.00', $diff['warnings'][0] );
	}

	/** Unidentifiable rows block the recalculation. */
	public function test_ambiguous_and_manual_splits_block() {
		$generated = Recalculation::generated( $this->history( $this->gross() ) );
		$extra     = $this->children();
		$extra[]   = array_merge( $extra[2], array( 'id' => 14 ) );
		$this->assertSame( Recalculation::BLOCKED, Recalculation::diff( $extra, $generated, $this->net() )['status'] );
		$missing = array_slice( $this->children(), 0, 2 );
		$this->assertSame( Recalculation::BLOCKED, Recalculation::diff( $missing, $generated, $this->net() )['status'] );
		$this->assertSame( Recalculation::BLOCKED, Recalculation::diff( $this->children(), null, $this->net() )['status'] );
		// Two new adjustments cannot inherit one cost row's categorization.
		$two   = $this->net();
		$two[] = $this->row( 'settlement', '-0.25', 'fee:report#2', null, 'Refunds' );
		$this->assertSame( Recalculation::BLOCKED, Recalculation::diff( $this->children(), $generated, $two )['status'] );
		// A payment link that disagrees with the saved evidence.
		$moved                      = $this->net();
		$moved[0]['transaction_id'] = 3;
		$this->assertSame( Recalculation::BLOCKED, Recalculation::diff( $this->children(), $generated, $moved )['status'] );
	}

	/** A generated cost row with no replacement is removed only when unedited. */
	public function test_removing_cost_rows() {
		$generated = Recalculation::generated( $this->history( $this->gross() ) );
		$rows      = array_slice( $this->net(), 0, 2 );
		$diff      = Recalculation::diff( $this->children(), $generated, $rows );
		$this->assertSame( Recalculation::PROPOSED, $diff['status'] );
		$this->assertSame( Recalculation::REMOVE, array_column( $diff['changes'], 'action', 'id' )[13] );
		$edited              = $this->children();
		$edited[2]['amount'] = '-15.30';
		$this->assertSame( Recalculation::BLOCKED, Recalculation::diff( $edited, $generated, $rows )['status'] );
		// A tag edit alone is not a manual amount or text change.
		$tagged           = $this->children();
		$tagged[2]['tag'] = 'bank';
		$this->assertSame( Recalculation::PROPOSED, Recalculation::diff( $tagged, $generated, $rows )['status'] );
	}

	/** A new adjustment without an old cost row is added untagged. */
	public function test_new_adjustment_is_untagged() {
		$gross    = array_slice( $this->gross(), 0, 2 );
		$children = array_slice( $this->children(), 0, 2 );
		$diff     = Recalculation::diff( $children, Recalculation::generated( $this->history( $gross, array( 11, 12 ) ) ), $this->net() );
		$added    = array_values(
			array_filter(
				$diff['changes'],
				static function ( $change ) {
					return Recalculation::ADD === $change['action'];
				}
			)
		);
		$this->assertCount( 1, $added );
		$this->assertNull( $added[0]['tag'] );
		$this->assertNull( $added[0]['budget_id'] );
	}
}
