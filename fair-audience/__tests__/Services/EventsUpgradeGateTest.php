<?php
/**
 * Fair Audience's upgrade gate tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use FairAudience\Services\EventsUpgradeGate;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

/**
 * Covers PAYMENT_HISTORY_MIGRATION.md §8.17 from Fair Audience's side: it
 * follows Fair Events' decision, refuses next to a Fair Events without the
 * check, and runs while Fair Events is inactive. Each case defines Fair
 * Events' constant or class, so each runs in its own process.
 */
class EventsUpgradeGateTest extends TestCase {

	/**
	 * Define a stand-in for Fair Events' check answering $allowed.
	 *
	 * @param bool $allowed Decision.
	 * @return void
	 */
	private static function define_events_gate( $allowed ) {
		$GLOBALS['_fair_test_events_gate_allowed'] = $allowed;
		// phpcs:ignore Squiz.PHP.Eval.Discouraged -- a class can be defined only once per process.
		eval( 'namespace FairEvents\\Services; class PaymentHistoryUpgrade { public static function allows_initialization() { return $GLOBALS["_fair_test_events_gate_allowed"]; } }' );
	}

	/**
	 * Without Fair Events, Fair Audience starts.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_allows_without_fair_events(): void {
		$this->assertTrue( EventsUpgradeGate::allows_initialization() );
		$this->assertNull( EventsUpgradeGate::refusal_reason() );
	}

	/**
	 * A Fair Events older than the check must be updated first.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_refuses_next_to_an_older_fair_events(): void {
		define( 'FAIR_EVENTS_VERSION', '2.2.0' );
		$this->assertFalse( EventsUpgradeGate::allows_initialization() );
		$this->assertSame( EventsUpgradeGate::REASON_EVENTS_OUTDATED, EventsUpgradeGate::refusal_reason() );
	}

	/**
	 * Fair Audience follows Fair Events' refusal.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_follows_fair_events_refusal(): void {
		define( 'FAIR_EVENTS_VERSION', '2.3.0' );
		self::define_events_gate( false );
		$this->assertFalse( EventsUpgradeGate::allows_initialization() );
		$this->assertSame( EventsUpgradeGate::REASON_UPGRADE_UNSUPPORTED, EventsUpgradeGate::refusal_reason() );
	}

	/**
	 * Fair Audience follows Fair Events' approval.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_follows_fair_events_approval(): void {
		define( 'FAIR_EVENTS_VERSION', '2.3.0' );
		self::define_events_gate( true );
		$this->assertTrue( EventsUpgradeGate::allows_initialization() );
		$this->assertNull( EventsUpgradeGate::refusal_reason() );
	}

	/**
	 * Fair Audience may ask before Fair Events is loaded (plugins load
	 * alphabetically; a bulk activation runs Audience's hook first). That
	 * answer isn't kept: once Fair Events is loaded, its decision applies.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_follows_fair_events_loaded_after_audience(): void {
		$this->assertTrue( EventsUpgradeGate::allows_initialization() );

		define( 'FAIR_EVENTS_VERSION', '2.3.0' );
		self::define_events_gate( false );
		$this->assertFalse( EventsUpgradeGate::allows_initialization() );
		$this->assertSame( EventsUpgradeGate::REASON_UPGRADE_UNSUPPORTED, EventsUpgradeGate::refusal_reason() );
	}

	/**
	 * Fair Events' decision is asked once per request, whichever plugin
	 * asks first, so a site Fair Events finds without history to migrate
	 * starts both plugins on the same evidence.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_asks_fair_events_once_per_request(): void {
		define( 'FAIR_EVENTS_VERSION', '2.3.0' );
		$GLOBALS['_fair_test_events_gate_calls'] = 0;
		// phpcs:ignore Squiz.PHP.Eval.Discouraged -- a class can be defined only once per process.
		eval( 'namespace FairEvents\\Services; class PaymentHistoryUpgrade { public static function allows_initialization() { ++$GLOBALS["_fair_test_events_gate_calls"]; return true; } }' );

		$this->assertTrue( EventsUpgradeGate::allows_initialization() );
		$this->assertTrue( EventsUpgradeGate::allows_initialization() );
		$this->assertSame( 1, $GLOBALS['_fair_test_events_gate_calls'] );
	}
}
