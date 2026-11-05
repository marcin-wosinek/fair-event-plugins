<?php
/**
 * Cron lifecycle tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Core;

use FairAudience\Core\Cron;
use FairAudience\Hooks\PaymentHooks;
use FairAudience\Hooks\PendingSubscriptionTimeoutHooks;
use PHPUnit\Framework\TestCase;

/**
 * Interval ordering, verified scheduling and deactivation cleanup.
 */
class CronTest extends TestCase {

	/**
	 * Start with no hooks and an empty schedule.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_hooks'] = array();
		$GLOBALS['_fair_test_cron']  = array();
		ini_set( 'error_log', '/dev/null' ); // phpcs:ignore WordPress.PHP.IniSet.Risky -- keeps the expected failure logs out of the test output.
	}

	/**
	 * Callbacks registered for a hook.
	 *
	 * @param string $hook Hook name.
	 * @return array
	 */
	private static function callbacks( $hook ) {
		return array_column( $GLOBALS['_fair_test_hooks'][ $hook ] ?? array(), 'callback' );
	}

	/** Both recurring events get the five-minute interval on the first request, once each. */
	public function test_first_request_schedules_both_events_once() {
		PaymentHooks::init();
		PendingSubscriptionTimeoutHooks::init();

		// One interval filter, and scheduling waits for `init`.
		$this->assertSame( array( array( Cron::class, 'add_interval' ) ), self::callbacks( 'cron_schedules' ) );
		$this->assertSame( array(), $GLOBALS['_fair_test_cron'] );
		foreach ( self::callbacks( 'init' ) as $callback ) {
			call_user_func( $callback );
			call_user_func( $callback );
		}

		foreach ( array( PaymentHooks::CLEANUP_HOOK, PendingSubscriptionTimeoutHooks::CRON_HOOK ) as $hook ) {
			$this->assertCount( 1, $GLOBALS['_fair_test_cron'][ $hook ], $hook );
			$this->assertSame( Cron::EVERY_FIVE_MINUTES, $GLOBALS['_fair_test_cron'][ $hook ][0][2] );
		}
	}

	/** Without its interval the event is refused, reported, and scheduled once the interval exists. */
	public function test_missing_interval_is_reported_and_retried() {
		$this->assertSame( 'invalid_schedule', PaymentHooks::schedule_cleanup() );
		$this->assertFalse( wp_next_scheduled( PaymentHooks::CLEANUP_HOOK ) );

		Cron::register_interval();
		Cron::register_interval();

		$this->assertCount( 1, self::callbacks( 'cron_schedules' ) );
		$this->assertTrue( PaymentHooks::schedule_cleanup() );
		$this->assertNotFalse( wp_next_scheduled( PaymentHooks::CLEANUP_HOOK ) );
	}

	/** An existing event keeps its time. */
	public function test_existing_event_is_kept() {
		$GLOBALS['_fair_test_cron'][ PendingSubscriptionTimeoutHooks::CRON_HOOK ][] = array( 1000, array(), Cron::EVERY_FIVE_MINUTES );

		$this->assertTrue( PendingSubscriptionTimeoutHooks::schedule() );
		$this->assertSame( 1000, wp_next_scheduled( PendingSubscriptionTimeoutHooks::CRON_HOOK ) );
	}

	/** Deactivation removes this plugin's events and leaves the companion's. */
	public function test_deactivation_removes_only_owned_events() {
		foreach ( Cron::OWNED_HOOKS as $hook ) {
			$GLOBALS['_fair_test_cron'][ $hook ][] = array( 1000, array() );
		}
		$GLOBALS['_fair_test_cron']['fair_audience_send_scheduled_messages'][] = array( 1000, array() );

		Cron::deactivate();

		$this->assertSame( array( 'fair_audience_send_scheduled_messages' ), array_keys( $GLOBALS['_fair_test_cron'] ) );
	}
}
