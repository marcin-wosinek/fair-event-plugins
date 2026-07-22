<?php
/**
 * PendingSubscriptionTimeoutHooks cutoff tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Hooks;

use PHPUnit\Framework\TestCase;
use FairAudience\Hooks\PendingSubscriptionTimeoutHooks;

/**
 * Validates the one pure seam of the sweep: the timeout cutoff is exactly one
 * week (in UTC) before the reference instant. The DB sweep and consent logging
 * need a live database and are covered by the WP-CLI manual-check recipe, not
 * here.
 */
class PendingSubscriptionTimeoutHooksTest extends TestCase {

	/**
	 * The cutoff is now minus one week, formatted as a UTC MySQL datetime.
	 */
	public function test_cutoff_is_one_week_before_the_reference_time() {
		// 2026-07-22 12:00:00 UTC.
		$now = gmmktime( 12, 0, 0, 7, 22, 2026 );

		$this->assertSame(
			'2026-07-15 12:00:00',
			PendingSubscriptionTimeoutHooks::cutoff( $now )
		);
	}

	/**
	 * Called without an argument, the cutoff defaults to a week before now.
	 */
	public function test_cutoff_defaults_to_a_week_before_now() {
		$expected = gmdate( 'Y-m-d H:i:s', time() - WEEK_IN_SECONDS );

		// Allow a 2-second window so a clock tick between the two calls can't
		// flake the assertion.
		$this->assertLessThanOrEqual(
			2,
			abs( strtotime( PendingSubscriptionTimeoutHooks::cutoff() ) - strtotime( $expected ) )
		);
	}
}
