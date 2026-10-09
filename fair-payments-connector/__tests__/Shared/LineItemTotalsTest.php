<?php
/**
 * FairEventsShared\LineItemTotals rounding policy tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Shared;

use PHPUnit\Framework\TestCase;
use FairEventsShared\LineItemTotals;

/**
 * Unit tests for the shared line-item calculator: two decimals, half up,
 * rounded per unit amount, per line and for the aggregate.
 */
class LineItemTotalsTest extends TestCase {

	/**
	 * Ordinary two-decimal amounts come back unchanged.
	 */
	public function test_ordinary_amounts_are_unchanged(): void {
		$this->assertSame( 12.5, LineItemTotals::normalize_amount( 12.5 ) );
		$this->assertSame( 19.99, LineItemTotals::normalize_amount( '19.99' ) );
		$this->assertSame( 0.0, LineItemTotals::normalize_amount( 0 ) );
		$this->assertSame( 30.0, LineItemTotals::line_total( 3, 10 ) );
		$this->assertSame(
			44.99,
			LineItemTotals::total(
				array(
					array(
						'quantity' => 2,
						'amount'   => 12.5,
					),
					array(
						'quantity' => 1,
						'amount'   => 19.99,
					),
				)
			)
		);
	}

	/**
	 * Amounts on either side of half a cent, and exactly on it.
	 *
	 * @return array[]
	 */
	public function half_cent_boundaries(): array {
		return array(
			'just below half a cent'     => array( 0.004, 0.0 ),
			'half a cent'                => array( 0.005, 0.01 ),
			'just above half a cent'     => array( 0.006, 0.01 ),
			'half a cent above a euro'   => array( 1.005, 1.01 ),
			'below half above a euro'    => array( 1.004, 1.0 ),
			'half a cent, larger amount' => array( 10.005, 10.01 ),
			'third decimal five'         => array( 2.675, 2.68 ),
			'negative half a cent'       => array( -0.005, -0.01 ),
			'negative below half a cent' => array( -0.004, 0.0 ),
			'negative third decimal'     => array( -1.005, -1.01 ),
		);
	}

	/**
	 * Halves round up — away from zero — and everything below them down.
	 *
	 * @dataProvider half_cent_boundaries
	 *
	 * @param float $amount   Raw amount.
	 * @param float $expected Normalized amount.
	 */
	public function test_rounds_half_up( $amount, $expected ): void {
		$this->assertSame( $expected, LineItemTotals::normalize_amount( $amount ) );
	}

	/**
	 * An amount that rounds to zero from below is plain zero, not -0.0.
	 */
	public function test_negative_amount_rounding_to_zero_is_not_negative_zero(): void {
		$this->assertSame( '0', (string) LineItemTotals::normalize_amount( -0.004 ) );
	}

	/**
	 * The unit amount is rounded before it is multiplied by the quantity.
	 */
	public function test_unit_amount_is_rounded_before_the_quantity_applies(): void {
		// 3 × 0.005 is 0.015 unrounded; rounded first it is 3 × 0.01.
		$this->assertSame( 0.03, LineItemTotals::line_total( 3, 0.005 ) );
		// 3 × 0.004 is 0.012 unrounded; rounded first it is 3 × 0.00.
		$this->assertSame( 0.0, LineItemTotals::line_total( 3, 0.004 ) );
		$this->assertSame( 30.03, LineItemTotals::line_total( 3, 10.005 ) );
	}

	/**
	 * Float noise in a product never leaks into a line total.
	 */
	public function test_line_total_has_two_decimals(): void {
		$this->assertSame( 0.3, LineItemTotals::line_total( 3, 0.1 ) );
		$this->assertSame( 3.3, LineItemTotals::line_total( 3, 1.1 ) );
	}

	/**
	 * Each line is rounded on its own before the lines are summed.
	 */
	public function test_lines_are_rounded_independently(): void {
		// Three lines of 0.004 sum to 0.012 unrounded: each is nothing.
		$this->assertSame(
			0.0,
			LineItemTotals::total(
				array(
					array( 'amount' => 0.004 ),
					array( 'amount' => 0.004 ),
					array( 'amount' => 0.004 ),
				)
			)
		);

		// Two lines of 0.005 sum to 0.01 unrounded: each is a cent.
		$this->assertSame(
			0.02,
			LineItemTotals::total(
				array(
					array( 'amount' => 0.005 ),
					array( 'amount' => 0.005 ),
				)
			)
		);

		$this->assertSame(
			25.03,
			LineItemTotals::total(
				array(
					array(
						'quantity' => 2,
						'amount'   => 10.005,
					),
					array(
						'quantity' => 1,
						'amount'   => 5.004,
					),
					array(
						'quantity' => 1,
						'amount'   => 0.006,
					),
				)
			)
		);
	}

	/**
	 * The sum of many two-decimal lines carries no float noise.
	 */
	public function test_aggregate_has_two_decimals(): void {
		$this->assertSame(
			0.3,
			LineItemTotals::total(
				array(
					array( 'amount' => 0.1 ),
					array( 'amount' => 0.1 ),
					array( 'amount' => 0.1 ),
				)
			)
		);
	}

	/**
	 * A line without a quantity counts once.
	 */
	public function test_omitted_quantity_defaults_to_one(): void {
		$this->assertSame( 12.5, LineItemTotals::total( array( array( 'amount' => 12.5 ) ) ) );
	}

	/**
	 * A negative line is a discount and lowers the total.
	 */
	public function test_negative_lines_are_discounts(): void {
		$this->assertSame( -5.0, LineItemTotals::line_total( 2, -2.5 ) );
		$this->assertSame(
			15.0,
			LineItemTotals::total(
				array(
					array(
						'quantity' => 2,
						'amount'   => 10,
					),
					array(
						'quantity' => 1,
						'amount'   => -5,
					),
				)
			)
		);
		$this->assertSame(
			-2.0,
			LineItemTotals::total(
				array(
					array( 'amount' => 3 ),
					array( 'amount' => -5 ),
				)
			)
		);
	}

	/**
	 * A discount cancelling the charge exactly leaves exactly zero.
	 */
	public function test_exact_cancellation_is_zero(): void {
		$total = LineItemTotals::total(
			array(
				array(
					'quantity' => 3,
					'amount'   => 0.1,
				),
				array( 'amount' => -0.3 ),
			)
		);

		$this->assertSame( 0.0, $total );
		$this->assertFalse( $total > 0 );
	}

	/**
	 * A cent is the smallest total there is to pay; anything below half of
	 * it is nothing.
	 */
	public function test_totals_around_zero(): void {
		$this->assertSame( 0.0, LineItemTotals::total( array() ) );
		$this->assertSame( 0.0, LineItemTotals::total( array( array( 'amount' => 0.004 ) ) ) );
		$this->assertSame( 0.01, LineItemTotals::total( array( array( 'amount' => 0.005 ) ) ) );
		$this->assertSame( 0.01, LineItemTotals::total( array( array( 'amount' => 0.01 ) ) ) );
		$this->assertSame(
			0.01,
			LineItemTotals::total(
				array(
					array( 'amount' => 10 ),
					array( 'amount' => -9.99 ),
				)
			)
		);
	}

	/**
	 * Amounts are compared to the cent, never as raw floats.
	 */
	public function test_amounts_match_at_cent_precision(): void {
		$this->assertTrue( LineItemTotals::amounts_match( 0.1 + 0.2, 0.3 ) );
		$this->assertTrue( LineItemTotals::amounts_match( '10.00', 10 ) );
		$this->assertTrue( LineItemTotals::amounts_match( 10.004, 10 ) );
		$this->assertFalse( LineItemTotals::amounts_match( 10.005, 10 ) );
		$this->assertFalse( LineItemTotals::amounts_match( 10.01, 10 ) );
		$this->assertFalse( LineItemTotals::amounts_match( -10, 10 ) );
	}
}
