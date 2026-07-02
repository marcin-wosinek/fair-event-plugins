<?php
/**
 * EventSignupPricing discount math tests
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEventsExperimental\Services\EventSignupPricing;

/**
 * Validates the pure discount math used by the resolver. Database-backed
 * lookups are exercised via API integration tests, not here.
 */
class EventSignupPricingTest extends TestCase {

	public function test_percentage_discount() {
		$this->assertEqualsWithDelta( 4.0, EventSignupPricing::apply_discount( 5.0, 'percentage', 20 ), 0.001 );
	}

	public function test_full_percentage_discount_zeros_out() {
		$this->assertEqualsWithDelta( 0.0, EventSignupPricing::apply_discount( 5.0, 'percentage', 100 ), 0.001 );
	}

	public function test_fixed_amount_discount() {
		$this->assertEqualsWithDelta( 3.5, EventSignupPricing::apply_discount( 5.0, 'amount', 1.5 ), 0.001 );
	}

	public function test_amount_discount_can_go_negative_before_clamp() {
		// resolver clamps to 0 separately; this asserts raw math.
		$this->assertEqualsWithDelta( -2.0, EventSignupPricing::apply_discount( 3.0, 'amount', 5.0 ), 0.001 );
	}

	public function test_clamp_in_band_amount_is_unchanged() {
		$this->assertEqualsWithDelta(
			15.0,
			EventSignupPricing::clamp_amount_to_range( 15.0, 5.0, 50.0, 20.0 ),
			0.001
		);
	}

	public function test_clamp_below_min_is_raised_to_min() {
		$this->assertEqualsWithDelta(
			5.0,
			EventSignupPricing::clamp_amount_to_range( 1.0, 5.0, 50.0, 20.0 ),
			0.001
		);
	}

	public function test_clamp_above_max_is_lowered_to_max() {
		$this->assertEqualsWithDelta(
			50.0,
			EventSignupPricing::clamp_amount_to_range( 999.0, 5.0, 50.0, 20.0 ),
			0.001
		);
	}

	public function test_clamp_non_finite_falls_back_to_suggested() {
		$this->assertEqualsWithDelta(
			20.0,
			EventSignupPricing::clamp_amount_to_range( NAN, 5.0, 50.0, 20.0 ),
			0.001
		);
		$this->assertEqualsWithDelta(
			20.0,
			EventSignupPricing::clamp_amount_to_range( INF, 5.0, 50.0, 20.0 ),
			0.001
		);
	}

	public function test_clamp_non_numeric_falls_back_to_suggested() {
		$this->assertEqualsWithDelta(
			20.0,
			EventSignupPricing::clamp_amount_to_range( 'not-a-number', 5.0, 50.0, 20.0 ),
			0.001
		);
		$this->assertEqualsWithDelta(
			20.0,
			EventSignupPricing::clamp_amount_to_range( null, 5.0, 50.0, 20.0 ),
			0.001
		);
	}

	public function test_clamp_min_equals_max_locks_the_amount() {
		$this->assertEqualsWithDelta(
			10.0,
			EventSignupPricing::clamp_amount_to_range( 3.0, 10.0, 10.0, 10.0 ),
			0.001
		);
	}
}
