<?php
/**
 * Test-only stand-in for a stale FairEvents\Services\TicketAvailability build.
 *
 * Reproduces the version-skew shape fair-events can drift into relative to
 * what fair-audience's TicketAvailabilityResolver expects (issue #1581): a
 * build that predates the `TicketAvailability` service entirely lands with
 * the class present (if fair-events ships *some* class at that FQN in a
 * future refactor) but missing `is_ticket_type_enabled()` — `class_exists()`
 * alone can't catch this; TicketAvailabilityResolver also needs the
 * `method_exists()` guard. fair-audience's real composer autoload never
 * loads the actual FairEvents classes (its psr-4 map only covers
 * FairAudience\), so TicketAvailabilityResolverTest requires this fixture
 * directly instead.
 *
 * @package FairAudience
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * Minimal stand-in reproducing a stale fair-events shape missing the method
 * TicketAvailabilityResolver needs.
 */
class TicketAvailability {

	/**
	 * Unrelated method — stands in for whatever the stale build actually
	 * exposes, just not `is_ticket_type_enabled()`.
	 *
	 * @return bool Always true.
	 */
	public static function some_other_method() {
		return true;
	}
}
