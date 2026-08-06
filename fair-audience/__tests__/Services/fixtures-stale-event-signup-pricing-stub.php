<?php
/**
 * Test-only stand-in for a stale FairEventsExperimental\Services\EventSignupPricing build.
 *
 * Reproduces the exact shape of a fair-events-experimental build that
 * predates issue #1297's resolve_price_and_rule()/resolve_price_and_rule_for_ticket_type()
 * methods: the class exists, but only the old resolve_price_for_ticket_type()
 * method does. fair-audience's real composer autoload never loads the actual
 * FairEventsExperimental classes (its psr-4 map only covers FairAudience\),
 * so SignupPriceResolverTest requires this fixture directly instead.
 *
 * @package FairAudience
 */

namespace FairEventsExperimental\Services;

defined( 'WPINC' ) || die;

/**
 * Minimal stand-in reproducing a stale fair-events-experimental build.
 */
class EventSignupPricing {

	/**
	 * Old-interface stand-in. Returns a fixed price so tests can assert the
	 * facade actually reached it.
	 *
	 * @param int      $ticket_type_id Ticket type ID.
	 * @param int|null $participant_id Participant ID.
	 * @return float Fixed stub price.
	 */
	public static function resolve_price_for_ticket_type( $ticket_type_id, $participant_id = null ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- stub always returns a fixed price, kept param-compatible with the real signature.
		return 42.0;
	}
}
