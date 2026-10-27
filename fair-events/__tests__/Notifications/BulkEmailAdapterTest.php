<?php
/**
 * BulkEmailAdapter tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\BulkEmailAdapter;
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Group emails need a Fair Audience that reports each recipient.
 *
 * Each case loads its own Fair Audience stand-in, so each runs in a
 * separate process.
 */
#[RunTestsInSeparateProcesses]
#[PreserveGlobalState( false )]
class BulkEmailAdapterTest extends TestCase {

	/**
	 * Load a Fair Audience that hands the email over.
	 *
	 * @param string $release 'without-reporting', 'with-reporting' or 'with-feeds'.
	 * @return void
	 */
	private static function fair_audience( $release ) {
		define( 'FAIR_AUDIENCE_VERSION', 'test' );
		define( 'FAIR_AUDIENCE_EVENT_NOTIFICATIONS_HANDOFF', true );
		require_once __DIR__ . '/fakes/fair-audience/mailer-' . $release . '.php';
	}

	/** A Fair Audience that cannot report recipients must be updated first. */
	public function test_fair_audience_without_reporting_requires_an_update() {
		self::fair_audience( 'without-reporting' );
		$adapter = new BulkEmailAdapter();

		$this->assertSame( BulkEmailAdapter::UPDATE_REQUIRED, $adapter->availability() );
		$this->assertTrue( $adapter->needs_reporting_update() );
		$this->assertFalse( $adapter->needs_feed_update() );
	}

	/**
	 * A Fair Audience that would send a feed's email to every subscriber
	 * must be updated first.
	 */
	public function test_fair_audience_without_feeds_requires_an_update() {
		self::fair_audience( 'with-reporting' );
		$adapter = new BulkEmailAdapter();

		$this->assertSame( BulkEmailAdapter::UPDATE_REQUIRED, $adapter->availability() );
		$this->assertFalse( $adapter->needs_reporting_update() );
		$this->assertTrue( $adapter->needs_feed_update() );
	}

	/** A Fair Audience that reports recipients and limits each feed's email sends. */
	public function test_fair_audience_with_feeds_is_active() {
		self::fair_audience( 'with-feeds' );
		$adapter = new BulkEmailAdapter();

		$this->assertSame( BulkEmailAdapter::ACTIVE, $adapter->availability() );
		$this->assertFalse( $adapter->needs_reporting_update() );
		$this->assertFalse( $adapter->needs_feed_update() );
	}

	/** Without Fair Audience nothing is sent, and no update is asked for. */
	public function test_inactive_fair_audience() {
		$adapter = new BulkEmailAdapter();

		$this->assertSame( BulkEmailAdapter::INACTIVE, $adapter->availability() );
		$this->assertFalse( $adapter->needs_reporting_update() );
		$this->assertFalse( $adapter->needs_feed_update() );
	}
}
