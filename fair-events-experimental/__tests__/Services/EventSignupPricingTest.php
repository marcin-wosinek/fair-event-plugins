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

	/**
	 * Build a discount rule stub.
	 *
	 * @param int    $id             Rule ID.
	 * @param string $discount_type  'percentage' or 'amount'.
	 * @param float  $discount_value Discount magnitude.
	 * @return object
	 */
	private function rule( $id, $discount_type, $discount_value ) {
		$rule                 = new \stdClass();
		$rule->id             = $id;
		$rule->discount_type  = $discount_type;
		$rule->discount_value = $discount_value;
		return $rule;
	}

	/**
	 * With one matching rule, that rule wins and its discounted price is
	 * returned.
	 */
	public function test_best_rule_for_price_single_rule_wins() {
		$result = EventSignupPricing::best_rule_for_price( 10.0, array( $this->rule( 1, 'percentage', 20 ) ) );

		$this->assertEqualsWithDelta( 8.0, $result['price'], 0.0001 );
		$this->assertSame( 1, $result['rule']->id );
	}

	/**
	 * Percentage vs. fixed-amount rules must be compared against the real
	 * base price, not a notional reference price (issue #1297). At a base
	 * price of €10, a 50% rule (→ €5) beats a €2 amount rule (→ €8).
	 */
	public function test_best_rule_for_price_picks_the_rule_that_wins_on_the_real_price() {
		$percentage_rule = $this->rule( 1, 'percentage', 50 );
		$amount_rule     = $this->rule( 2, 'amount', 2 );

		$result = EventSignupPricing::best_rule_for_price( 10.0, array( $percentage_rule, $amount_rule ) );

		$this->assertEqualsWithDelta( 5.0, $result['price'], 0.0001 );
		$this->assertSame( 1, $result['rule']->id );
	}

	/**
	 * At a different base price the ranking can flip — the €2 amount rule
	 * now beats the 10% percentage rule, proving the winner depends on the
	 * real price rather than a fixed reference.
	 */
	public function test_best_rule_for_price_ranking_depends_on_base_price() {
		$percentage_rule = $this->rule( 1, 'percentage', 10 );
		$amount_rule     = $this->rule( 2, 'amount', 2 );

		$result = EventSignupPricing::best_rule_for_price( 5.0, array( $percentage_rule, $amount_rule ) );

		// 10% off €5 = €4.50; €5 - €2 = €3.00 → amount rule wins here.
		$this->assertEqualsWithDelta( 3.0, $result['price'], 0.0001 );
		$this->assertSame( 2, $result['rule']->id );
	}

	/**
	 * A percentage rule can never move a €0 base price (any percentage of
	 * zero is still zero), so it never comes back with a rule attached —
	 * there's nothing to visibly discount and no note should appear.
	 */
	public function test_best_rule_for_price_suppresses_rule_on_free_percentage_tier() {
		$result = EventSignupPricing::best_rule_for_price( 0.0, array( $this->rule( 1, 'percentage', 20 ) ) );

		$this->assertEqualsWithDelta( 0.0, $result['price'], 0.0001 );
		$this->assertNull( $result['rule'] );
	}

	/**
	 * An amount rule genuinely changes a €0 base price (into a negative,
	 * "solidarity ticket" amount), so — unlike a percentage rule — it does
	 * come back with a rule attached; callers clamp the display/charge at 0
	 * separately. This mirrors the existing ticket-type resolver's behavior.
	 */
	public function test_best_rule_for_price_amount_rule_still_applies_to_free_tier() {
		$result = EventSignupPricing::best_rule_for_price( 0.0, array( $this->rule( 1, 'amount', 5 ) ) );

		$this->assertEqualsWithDelta( -5.0, $result['price'], 0.0001 );
		$this->assertSame( 1, $result['rule']->id );
	}

	/**
	 * A fractional discount_value passes through unrounded — the resolver
	 * itself does no display formatting.
	 */
	public function test_best_rule_for_price_fractional_discount_value_passthrough() {
		$result = EventSignupPricing::best_rule_for_price( 10.0, array( $this->rule( 1, 'percentage', 12.5 ) ) );

		$this->assertEqualsWithDelta( 8.75, $result['price'], 0.0001 );
		$this->assertEqualsWithDelta( 12.5, $result['rule']->discount_value, 0.0001 );
	}

	/**
	 * No matching rules leaves the base price untouched with no rule.
	 */
	public function test_best_rule_for_price_no_rules_returns_base_price() {
		$result = EventSignupPricing::best_rule_for_price( 10.0, array() );

		$this->assertSame( 10.0, $result['price'] );
		$this->assertNull( $result['rule'] );
	}
}
