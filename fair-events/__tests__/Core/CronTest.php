<?php
/**
 * Cron lifecycle tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Core;

use FairEvents\Core\Cron;
use FairEvents\Hooks\PaymentHooks;
use FairEvents\Notifications\Notifications;
use FairEvents\Services\TicketBackfill;
use PHPUnit\Framework\TestCase;

/**
 * Verified scheduling, retry after failure, and deactivation cleanup.
 */
class CronTest extends TestCase {

	/**
	 * Start with an empty schedule.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']   = array();
		$GLOBALS['_fair_test_cron']      = array();
		$GLOBALS['_fair_test_cron_fail'] = array();
		ini_set( 'error_log', '/dev/null' ); // phpcs:ignore WordPress.PHP.IniSet.Risky -- keeps the expected failure logs out of the test output.
	}

	/**
	 * Clean up.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['_fair_test_cron_fail'] = array();
	}

	/** A missing event is scheduled once; repeated calls keep the first one. */
	public function test_repeated_reconciliation_schedules_once() {
		$this->assertTrue( PaymentHooks::schedule_cleanup() );
		$first = wp_next_scheduled( PaymentHooks::CLEANUP_HOOK );

		$this->assertTrue( PaymentHooks::schedule_cleanup() );

		$this->assertCount( 1, $GLOBALS['_fair_test_cron'][ PaymentHooks::CLEANUP_HOOK ] );
		$this->assertSame( $first, wp_next_scheduled( PaymentHooks::CLEANUP_HOOK ) );
		$this->assertSame( 'hourly', $GLOBALS['_fair_test_cron'][ PaymentHooks::CLEANUP_HOOK ][0][2] );
	}

	/** A refused event is reported with a sanitized code and scheduled on the next attempt. */
	public function test_failed_scheduling_is_reported_and_retried() {
		$GLOBALS['_fair_test_cron_fail'][ PaymentHooks::CLEANUP_HOOK ] = true;

		$this->assertSame( 'could_not_set', PaymentHooks::schedule_cleanup() );
		$this->assertFalse( wp_next_scheduled( PaymentHooks::CLEANUP_HOOK ) );

		$GLOBALS['_fair_test_cron_fail'] = array();

		$this->assertTrue( PaymentHooks::schedule_cleanup() );
		$this->assertNotFalse( wp_next_scheduled( PaymentHooks::CLEANUP_HOOK ) );
	}

	/** An event another request already added counts as scheduled. */
	public function test_existing_event_counts_as_success() {
		$GLOBALS['_fair_test_cron']['fair_events_test_hook'][]    = array( 1000, array( 'a' ), 'daily' );
		$GLOBALS['_fair_test_cron_fail']['fair_events_test_hook'] = true;

		$this->assertTrue( Cron::ensure_recurring( 'fair_events_test_hook', 'daily', 2000, array( 'a' ) ) );
		$this->assertTrue( Cron::ensure_single( 2000, 'fair_events_test_hook', array( 'a' ) ) );
	}

	/** Deactivation removes every event Fair Events owns, whatever its arguments. */
	public function test_deactivation_removes_every_owned_event() {
		$owned = array(
			PaymentHooks::CLEANUP_HOOK,
			Notifications::HISTORY_CLEANUP_HOOK,
			TicketBackfill::CRON_HOOK,
			\FairEvents\Notifications\TelegramDispatcher::HOOK,
			\FairEvents\Notifications\BulkEmailDispatcher::HOOK,
			\FairEvents\Notifications\IndividualEmailDispatcher::HOOK,
		);
		foreach ( $owned as $hook ) {
			$GLOBALS['_fair_test_cron'][ $hook ][] = array( 1000, array() );
			$GLOBALS['_fair_test_cron'][ $hook ][] = array( 2000, array( '2026-W42', 'members' ) );
		}
		$GLOBALS['_fair_test_cron']['fair_audience_cleanup_expired_signups'][] = array( 1000, array() );

		Cron::deactivate();

		foreach ( $owned as $hook ) {
			$this->assertArrayNotHasKey( $hook, $GLOBALS['_fair_test_cron'], $hook );
		}
		$this->assertArrayHasKey( 'fair_audience_cleanup_expired_signups', $GLOBALS['_fair_test_cron'] );
	}
}
