<?php
/**
 * SignupPriceResolver version-skew fallback tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Services\SignupPriceResolver;

require_once __DIR__ . '/fixtures-stale-event-signup-pricing-stub.php';

/**
 * Verifies SignupPriceResolver degrades to the base-price fallback instead
 * of fataling when fair-events-experimental is active but running a build
 * that has drifted out of sync with the pricing methods it's expected to
 * expose (issue #1421) — whether a method is missing entirely, or present
 * with an incompatible signature.
 */
class SignupPriceResolverTest extends TestCase {

	/**
	 * Confirms resolve_price_for_ticket_type() still reaches the stub's
	 * genuinely compatible method.
	 */
	public function test_resolve_price_for_ticket_type_uses_available_method() {
		$this->assertSame( 42.0, SignupPriceResolver::resolve_price_for_ticket_type( 1, 2 ) );
	}

	/**
	 * Confirms resolve_price_and_rule_for_ticket_type() degrades to null
	 * instead of fataling when the stub's method exists but has an
	 * incompatible signature (throws ArgumentCountError when called), and
	 * fair-events' TicketPricing class isn't loaded either in this unit
	 * test (so the final fallback is also unavailable). method_exists()
	 * alone can't catch this case — only the try/catch around the actual
	 * call does.
	 */
	public function test_resolve_price_and_rule_for_ticket_type_degrades_without_fatal() {
		$this->assertNull( SignupPriceResolver::resolve_price_and_rule_for_ticket_type( 1, 2 ) );
	}

	/**
	 * Confirms resolve_price_and_rule() degrades to the base price with no
	 * rule instead of fataling when the stale stub lacks the method.
	 */
	public function test_resolve_price_and_rule_degrades_to_base_price_without_fatal() {
		$result = SignupPriceResolver::resolve_price_and_rule( 20.0, 5, 2 );

		$this->assertSame(
			array(
				'price' => 20.0,
				'rule'  => null,
			),
			$result
		);
	}

	/**
	 * Confirms resolve_prices_and_rules_for_ticket_types() — the bulk
	 * facade added for issue #1299 — degrades to an empty result instead of
	 * fataling when the stale stub lacks the method and fair-events'
	 * TicketPricing isn't loaded in this isolated unit test either (the
	 * facade's own fallback chain, same as resolve_price_and_rule_for_ticket_type()).
	 */
	public function test_resolve_prices_and_rules_for_ticket_types_degrades_without_fatal() {
		$this->assertSame(
			array(),
			SignupPriceResolver::resolve_prices_and_rules_for_ticket_types( 5, array( 1, 2 ), 2 )
		);
	}

	/**
	 * Confirms resolve_prices_and_rules() — the bulk facade added for issue
	 * #1299 — degrades to passing every base price through unchanged with no
	 * rule, mirroring resolve_price_and_rule()'s own fallback, instead of
	 * fataling when the stale stub lacks the method.
	 */
	public function test_resolve_prices_and_rules_degrades_to_base_prices_without_fatal() {
		$result = SignupPriceResolver::resolve_prices_and_rules(
			5,
			array(
				10 => 20.0,
				11 => 0.0,
			),
			2
		);

		$this->assertSame(
			array(
				10 => array(
					'price' => 20.0,
					'rule'  => null,
				),
				11 => array(
					'price' => 0.0,
					'rule'  => null,
				),
			),
			$result
		);
	}
}
