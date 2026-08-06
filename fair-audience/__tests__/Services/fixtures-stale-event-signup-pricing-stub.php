<?php
/**
 * Test-only stand-in for a stale FairEventsExperimental\Services\EventSignupPricing build.
 *
 * Reproduces two distinct version-skew shapes fair-events-experimental can
 * drift into relative to what fair-audience expects (issue #1421):
 * - `resolve_price_and_rule()` is missing entirely, like a build that
 *   predates issue #1297.
 * - `resolve_price_and_rule_for_ticket_type()` exists but takes an
 *   incompatible signature (a new required parameter) — `method_exists()`
 *   alone can't catch this; SignupPriceResolver also needs to catch the
 *   resulting `ArgumentCountError`.
 *
 * `resolve_price_for_ticket_type()` keeps the real, compatible signature so
 * tests can also assert the guard still reaches a genuinely available
 * method. fair-audience's real composer autoload never loads the actual
 * FairEventsExperimental classes (its psr-4 map only covers FairAudience\),
 * so SignupPriceResolverTest requires this fixture directly instead.
 *
 * @package FairAudience
 */

namespace FairEventsExperimental\Services;

defined( 'WPINC' ) || die;

/**
 * Minimal stand-in reproducing two stale/incompatible fair-events-experimental shapes.
 */
class EventSignupPricing {

	/**
	 * Compatible old-interface stand-in. Returns a fixed price so tests can
	 * assert the facade actually reached it.
	 *
	 * @param int      $ticket_type_id Ticket type ID.
	 * @param int|null $participant_id Participant ID.
	 * @return float Fixed stub price.
	 */
	public static function resolve_price_for_ticket_type( $ticket_type_id, $participant_id = null ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- stub always returns a fixed price, kept param-compatible with the real signature.
		return 42.0;
	}

	/**
	 * Exists, but with an incompatible signature: a mandatory extra
	 * parameter the real interface doesn't have. Calling it the way
	 * SignupPriceResolver does (two args) throws ArgumentCountError.
	 *
	 * @param int      $ticket_type_id  Ticket type ID.
	 * @param int|null $participant_id  Participant ID.
	 * @param mixed    $unexpected_extra A parameter the real interface doesn't have.
	 * @return array{price: float, rule: object|null}
	 */
	public static function resolve_price_and_rule_for_ticket_type( $ticket_type_id, $participant_id, $unexpected_extra ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- unreachable: the mandatory 3rd arg is what makes the call incompatible.
		return array(
			'price' => 42.0,
			'rule'  => null,
		);
	}
}
