<?php
/**
 * PendingSubscriptionTimeoutHooks cutoff test
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Hooks;

use PHPUnit\Framework\TestCase;
use FairAudience\Hooks\PendingSubscriptionTimeoutHooks;
use DateTime;
use DateTimeZone;

/**
 * Validates the sweep's cutoff derivation. The DB query and per-participant
 * writes need a live WordPress instance and are covered by the WP-CLI
 * eval-file manual check instead (see TESTING.md).
 */
class PendingSubscriptionTimeoutHooksTest extends TestCase {

	/**
	 * Cutoff() resolves to exactly one week (WEEK_IN_SECONDS) before now, in UTC.
	 */
	public function test_cutoff_is_one_week_before_now() {
		$before = new DateTime( 'now', new DateTimeZone( 'UTC' ) );

		$cutoff = PendingSubscriptionTimeoutHooks::cutoff();

		$after = new DateTime( 'now', new DateTimeZone( 'UTC' ) );

		$cutoff_date = DateTime::createFromFormat( 'Y-m-d H:i:s', $cutoff, new DateTimeZone( 'UTC' ) );

		$expected_earliest = ( clone $before )->modify( '-' . WEEK_IN_SECONDS . ' seconds' );
		$expected_latest   = ( clone $after )->modify( '-' . WEEK_IN_SECONDS . ' seconds' );

		$this->assertGreaterThanOrEqual( $expected_earliest->getTimestamp(), $cutoff_date->getTimestamp() );
		$this->assertLessThanOrEqual( $expected_latest->getTimestamp(), $cutoff_date->getTimestamp() );
	}
}
