<?php
/**
 * TicketAvailabilityResolver version-skew fallback tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Services\TicketAvailabilityResolver;

require_once __DIR__ . '/fixtures-stale-ticket-availability-stub.php';

/**
 * Verifies TicketAvailabilityResolver degrades to its own local check
 * instead of fataling when fair-events is active but running a build that
 * predates `TicketAvailability::is_ticket_type_enabled()` (issue #1581), and
 * that the local fallback exactly mirrors the shared manual/scheduled
 * disabling boundary using WordPress site time.
 */
class TicketAvailabilityResolverTest extends TestCase {

	/**
	 * Build a ticket type stub.
	 *
	 * @param bool        $disabled   Manual disabled flag.
	 * @param string|null $disable_at Scheduled disable datetime, or null.
	 * @return object Anonymous ticket type object.
	 */
	private function ticket_type( $disabled = false, $disable_at = null ) {
		return (object) array(
			'disabled'   => $disabled,
			'disable_at' => $disable_at,
		);
	}

	/**
	 * An enabled type (no disabled flag, no disable_at) degrades to enabled.
	 */
	public function test_enabled_by_default() {
		$this->assertTrue( TicketAvailabilityResolver::is_ticket_type_enabled( $this->ticket_type() ) );
	}

	/**
	 * Manual disabling is rejected by the fallback, not just the shared
	 * service — closing the gap where EventSignupController previously
	 * checked only the scheduled disable_at boundary.
	 */
	public function test_manually_disabled_type_is_not_enabled() {
		$this->assertFalse( TicketAvailabilityResolver::is_ticket_type_enabled( $this->ticket_type( true ) ) );
	}

	/**
	 * A disable_at boundary already in the past is not enabled.
	 */
	public function test_past_disable_at_is_not_enabled() {
		$type = $this->ticket_type( false, gmdate( 'Y-m-d H:i:s', time() - 86400 ) );
		$this->assertFalse( TicketAvailabilityResolver::is_ticket_type_enabled( $type ) );
	}

	/**
	 * A disable_at boundary still in the future remains enabled — the
	 * fallback uses WordPress site time (current_time( 'mysql' )), never
	 * PHP's server-time strtotime()/time(), matching the shared service.
	 */
	public function test_future_disable_at_is_enabled() {
		$type = $this->ticket_type( false, gmdate( 'Y-m-d H:i:s', time() + 86400 ) );
		$this->assertTrue( TicketAvailabilityResolver::is_ticket_type_enabled( $type ) );
	}
}
