<?php
/**
 * Cron lifecycle tests
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Core;

use FairEventsExperimental\Core\Cron;
use FairEventsExperimental\Meta\Conversions;
use FairEventsExperimental\WhatsApp\Deliveries;
use PHPUnit\Framework\TestCase;

/**
 * Verified scheduling, retry after failure, and removing every owned event.
 */
class CronTest extends TestCase {

	/**
	 * Start with an empty schedule.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_cron']       = array();
		$GLOBALS['_fair_test_cron_fails'] = false;
		ini_set( 'error_log', '/dev/null' ); // phpcs:ignore WordPress.PHP.IniSet.Risky -- keeps the expected failure logs out of the test output.
	}

	/**
	 * Clean up.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['_fair_test_cron_fails'] = false;
	}

	/** A refused event is reported, then scheduled once on later requests. */
	public function test_failed_scheduling_is_reported_and_retried() {
		$GLOBALS['_fair_test_cron_fails'] = true;

		$this->assertSame( 'could_not_set', Cron::ensure_recurring( Deliveries::CLEANUP_HOOK, 'daily', 1000 ) );
		$this->assertFalse( wp_next_scheduled( Deliveries::CLEANUP_HOOK ) );

		$GLOBALS['_fair_test_cron_fails'] = false;

		$this->assertTrue( Cron::ensure_recurring( Deliveries::CLEANUP_HOOK, 'daily', 1000 ) );
		$this->assertTrue( Cron::ensure_recurring( Deliveries::CLEANUP_HOOK, 'daily', 5000 ) );
		$this->assertSame( 1000, wp_next_scheduled( Deliveries::CLEANUP_HOOK ) );
	}

	/** Every owned event goes, whatever its arguments; other plugins' events stay. */
	public function test_unschedule_removes_every_argument_variant() {
		wp_schedule_single_event( 1000, Conversions::DELIVERY_HOOK, array( 1000 ) );
		wp_schedule_single_event( 5000, Conversions::DELIVERY_HOOK, array( 5000 ) );
		wp_schedule_single_event( 6000, Conversions::DELIVERY_HOOK );
		wp_schedule_event( 1000, 'daily', Conversions::CLEANUP_HOOK );
		wp_schedule_event( 1000, 'daily', Deliveries::CLEANUP_HOOK );
		wp_schedule_event( 1000, 'daily', 'fair_events_notification_history_cleanup' );

		Cron::unschedule( Cron::META_HOOKS );

		$this->assertFalse( wp_next_scheduled( Conversions::CLEANUP_HOOK ) );
		$this->assertSame( 1000, wp_next_scheduled( Deliveries::CLEANUP_HOOK ) );

		Cron::unschedule( Cron::OWNED_HOOKS );

		$this->assertSame(
			array( 1000 => array( 'fair_events_notification_history_cleanup' ) ),
			array_map( 'array_keys', _get_cron_array() )
		);
	}
}
