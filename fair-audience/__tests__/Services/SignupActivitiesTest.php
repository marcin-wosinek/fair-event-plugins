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
 * Validates the pure effective-minimum and capacity logic behind #1243,
 * without needing fair-events-experimental loaded — mirrors
 * GroupSignupPricingTest from #1242.
 */
class SignupActivitiesTest extends TestCase {
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
}
