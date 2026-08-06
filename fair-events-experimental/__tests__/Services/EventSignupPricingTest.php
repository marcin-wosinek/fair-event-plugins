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

	/**
	 * Covers filter_matching_rules() — the pure rule-matching step behind the
	 * bulk resolver's single get_by_participant() call (issue #1299),
	 * replacing resolve_price_and_rule()'s per-rule
	 * get_by_group_and_participant() loop.
	 */

	/**
	 * A rule whose group the participant belongs to is kept.
	 */
	public function test_filter_matching_rules_keeps_matching_group() {
		$rule           = $this->rule( 1, 'percentage', 20 );
		$rule->group_id = 5;

		$result = EventSignupPricing::filter_matching_rules( array( $rule ), array( 5, 6 ) );

		$this->assertSame( array( $rule ), $result );
	}

	/**
	 * A rule whose group the participant does not belong to is dropped.
	 */
	public function test_filter_matching_rules_drops_non_matching_group() {
		$rule           = $this->rule( 1, 'percentage', 20 );
		$rule->group_id = 9;

		$result = EventSignupPricing::filter_matching_rules( array( $rule ), array( 5, 6 ) );

		$this->assertSame( array(), $result );
	}

	/**
	 * A mixed set of rules keeps only the ones matching the participant's
	 * groups, reindexed — this is the batch equivalent of calling
	 * get_by_group_and_participant() once per rule, done as one in-memory
	 * pass over a membership set fetched exactly once.
	 */
	public function test_filter_matching_rules_mixed_set() {
		$matching               = $this->rule( 1, 'percentage', 20 );
		$matching->group_id     = 5;
		$non_matching           = $this->rule( 2, 'amount', 3 );
		$non_matching->group_id = 9;

		$result = EventSignupPricing::filter_matching_rules( array( $matching, $non_matching ), array( 5 ) );

		$this->assertSame( array( $matching ), $result );
	}

	/**
	 * No membership at all matches nothing.
	 */
	public function test_filter_matching_rules_no_membership_matches_nothing() {
		$rule           = $this->rule( 1, 'percentage', 20 );
		$rule->group_id = 5;

		$result = EventSignupPricing::filter_matching_rules( array( $rule ), array() );

		$this->assertSame( array(), $result );
	}

	/**
	 * Covers resolve_prices_and_rules() — the bulk price+rule resolver.
	 */

	/**
	 * Without a participant, every key's base price passes through
	 * unchanged with no rule, and no rule/membership lookup is attempted —
	 * matches resolve_price_and_rule()'s anonymous-viewer fast path.
	 */
	public function test_resolve_prices_and_rules_without_participant_passes_prices_through() {
		$result = EventSignupPricing::resolve_prices_and_rules(
			5,
			array(
				1 => 10.0,
				2 => 0.0,
			),
			null
		);

		$this->assertSame(
			array(
				1 => array(
					'price' => 10.0,
					'rule'  => null,
				),
				2 => array(
					'price' => 0.0,
					'rule'  => null,
				),
			),
			$result
		);
	}

	/**
	 * An empty price map resolves to an empty result without touching
	 * anything else.
	 */
	public function test_resolve_prices_and_rules_empty_input_returns_empty() {
		$this->assertSame( array(), EventSignupPricing::resolve_prices_and_rules( 5, array(), 2 ) );
	}
}
