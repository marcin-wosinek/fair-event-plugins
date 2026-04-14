<?php
/**
 * EventSignupPricing discount math tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\EventSignupPricing;

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
}
