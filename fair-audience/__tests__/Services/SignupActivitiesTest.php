<?php
/**
 * SignupActivities pure logic tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Services\SignupActivities;

/**
 * Validates the pure effective-minimum, capacity, and discount-pricing logic
 * behind #1243, without needing fair-events-experimental loaded — mirrors
 * GroupSignupPricingTest from #1242. Duck-typed rule objects (`discount_type`/
 * `discount_value`) are used instead of the concrete experimental class.
 */
class SignupActivitiesTest extends TestCase {

	/**
	 * Build a discount rule stub.
	 *
	 * @param string $discount_type  'percentage' or 'amount'.
	 * @param float  $discount_value Discount magnitude.
	 * @return object
	 */
	private function rule( $discount_type, $discount_value ) {
		$rule                 = new \stdClass();
		$rule->discount_type  = $discount_type;
		$rule->discount_value = $discount_value;
		return $rule;
	}

	/**
	 * No minimum applies when neither the event-date global nor the ticket
	 * type raises it.
	 */
	public function test_effective_minimum_is_zero_when_unconfigured() {
		$this->assertSame( 0, SignupActivities::effective_minimum( 5, 0, 0 ) );
	}

	/**
	 * The event-date global applies when the ticket type doesn't raise it.
	 */
	public function test_effective_minimum_uses_global_when_type_does_not_raise() {
		$this->assertSame( 2, SignupActivities::effective_minimum( 5, 2, 0 ) );
	}

	/**
	 * A ticket type can raise the requirement above the event-date global.
	 */
	public function test_effective_minimum_uses_type_when_it_raises_above_global() {
		$this->assertSame( 3, SignupActivities::effective_minimum( 5, 1, 3 ) );
	}

	/**
	 * The requirement is capped at the number of options actually available,
	 * so it's never impossible to satisfy.
	 */
	public function test_effective_minimum_is_capped_at_option_count() {
		$this->assertSame( 2, SignupActivities::effective_minimum( 2, 5, 0 ) );
	}

	/**
	 * Reserved count below capacity is not full.
	 */
	public function test_capacity_reached_false_below_capacity() {
		$this->assertFalse( SignupActivities::capacity_reached( 3, 5 ) );
	}

	/**
	 * Reserved count at or above capacity is full.
	 */
	public function test_capacity_reached_true_at_or_above_capacity() {
		$this->assertTrue( SignupActivities::capacity_reached( 5, 5 ) );
		$this->assertTrue( SignupActivities::capacity_reached( 6, 5 ) );
	}

	/**
	 * A percentage discount reduces the price proportionally.
	 */
	public function test_apply_discount_percentage() {
		$this->assertEqualsWithDelta( 8.0, SignupActivities::apply_discount( 10.0, 'percentage', 20 ), 0.0001 );
	}

	/**
	 * An amount discount subtracts a flat value.
	 */
	public function test_apply_discount_amount() {
		$this->assertEqualsWithDelta( 7.0, SignupActivities::apply_discount( 10.0, 'amount', 3 ), 0.0001 );
	}

	/**
	 * Without a discount rule, the base price passes through unchanged.
	 */
	public function test_resolve_price_without_discount_rule() {
		$this->assertSame( 10.0, SignupActivities::resolve_price( 10.0, null ) );
	}

	/**
	 * With a discount rule and a positive base price, the discount is applied.
	 */
	public function test_resolve_price_with_discount_rule() {
		$price = SignupActivities::resolve_price( 10.0, $this->rule( 'percentage', 50 ) );
		$this->assertEqualsWithDelta( 5.0, $price, 0.0001 );
	}

	/**
	 * A free (zero-price) option is never discounted below zero — the
	 * discount is skipped entirely, matching the legacy render's
	 * `$opt_price > 0` guard.
	 */
	public function test_resolve_price_skips_discount_on_free_option() {
		$price = SignupActivities::resolve_price( 0.0, $this->rule( 'amount', 5 ) );
		$this->assertSame( 0.0, $price );
	}
}
