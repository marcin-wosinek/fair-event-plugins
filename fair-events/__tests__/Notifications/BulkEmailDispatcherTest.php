<?php
/**
 * BulkEmailDispatcher tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\BulkEmailAdapter;
use FairEvents\Notifications\BulkEmailDispatcher;
use FairEvents\Notifications\BulkEmailSettings;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fakes/FakeDeliveryLog.php';
require_once __DIR__ . '/fakes/FakeBulkEmailAdapter.php';
require_once __DIR__ . '/fakes/FakeWeeklyEvents.php';

/**
 * Weekly email delivery: at most once per send week, never replayed.
 */
class BulkEmailDispatcherTest extends TestCase {

	/**
	 * Delivery record.
	 *
	 * @var FakeDeliveryLog
	 */
	private $log;

	/**
	 * Fair Audience double.
	 *
	 * @var FakeBulkEmailAdapter
	 */
	private $adapter;

	/**
	 * Events double.
	 *
	 * @var FakeWeeklyEvents
	 */
	private $events;

	/**
	 * Set up fakes.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']  = array();
		$GLOBALS['_fair_test_cron']     = array();
		$GLOBALS['_fair_test_timezone'] = 'UTC';
		$this->log                      = new FakeDeliveryLog();
		$this->adapter                  = new FakeBulkEmailAdapter();
		$this->events                   = new FakeWeeklyEvents();
	}

	/**
	 * Clean up.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );
	}

	/**
	 * Enabled settings.
	 *
	 * @param array $overrides Field overrides.
	 * @return array
	 */
	private static function settings( array $overrides = array() ) {
		return BulkEmailSettings::sanitize(
			array_merge(
				array(
					'enabled'     => true,
					'source_slug' => 'members',
					'day_of_week' => 1,
					'time_of_day' => '08:00',
					'subject'     => 'Events',
				),
				$overrides
			)
		);
	}

	/**
	 * A moment in a timezone.
	 *
	 * @param string $time     Local time.
	 * @param string $timezone Timezone.
	 * @return \DateTimeImmutable
	 */
	private static function moment( $time, $timezone = 'UTC' ) {
		return new \DateTimeImmutable( $time, new \DateTimeZone( $timezone ) );
	}

	/**
	 * Run the dispatcher.
	 *
	 * @param string             $send_week Send week.
	 * @param array              $settings  Settings.
	 * @param \DateTimeImmutable $now       Now.
	 * @return array|null
	 */
	private function process( $send_week, array $settings, $now ) {
		return ( new BulkEmailDispatcher( $this->log, $this->adapter, $this->events ) )->process( 'bulk_email', $send_week, $settings, $now );
	}

	/** The email goes out once, with Fair Audience's counts recorded. */
	public function test_sends_the_weekly_email() {
		$run = $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'sent', $run['status'] );
		$this->assertSame( 'Sent: 12. Failed: 0. Skipped: 3.', $run['message'] );
		$this->assertSame( '2026-10-05', $run['week_start'] );
		$this->assertCount( 1, $this->adapter->sent );
		$this->assertSame( '2026-W41', $GLOBALS['_fair_test_options']['fair_events_notification_config_bulk_email_last_sent_week'] );
		$this->assertSame( 'sent', $this->log->rows['bulk_email|2026-10-05|bulk_email|subscribers|1']['state'] );
	}

	/** Emails Fair Audience could not deliver show in the run's status. */
	public function test_delivery_failures_are_visible() {
		$this->adapter->counts = array(
			'sent'    => 5,
			'failed'  => 2,
			'skipped' => 0,
		);
		$this->assertSame( 'partial', $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) )['status'] );

		$this->adapter->counts['sent'] = 0;
		$this->assertSame( 'failed', $this->process( '2026-W42', self::settings(), self::moment( '2026-10-12 08:00' ) )['status'] );
	}

	/** Overlapping or repeated cron runs for one send week send once. */
	public function test_second_run_for_the_same_send_week_sends_nothing() {
		$this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertNull( $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:01' ) ) );
		$this->assertCount( 1, $this->adapter->sent );
	}

	/** A send that ran a week late is dropped, not replayed. */
	public function test_late_run_in_another_week_is_not_replayed() {
		$run = $this->process( '2026-W41', self::settings(), self::moment( '2026-10-12 08:00' ) );

		$this->assertSame( 'expired', $run['status'] );
		$this->assertSame( array(), $this->adapter->sent );
		$this->assertSame( array(), $this->log->rows );
	}

	/** Without Fair Audience nothing is sent and the send week is not used up. */
	public function test_suspended_while_fair_audience_is_unavailable() {
		$this->adapter->availability = BulkEmailAdapter::INACTIVE;

		$run = $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'suspended', $run['status'] );
		$this->assertSame( array(), $this->adapter->sent );
		$this->assertSame( array(), $this->log->rows );
	}

	/** A turned-off channel does nothing, even for a queued job. */
	public function test_disabled_channel_does_nothing() {
		$this->assertNull( $this->process( '2026-W41', self::settings( array( 'enabled' => false ) ), self::moment( '2026-10-05 08:00' ) ) );
		$this->assertSame( array(), $this->adapter->sent );
		$this->assertSame( array(), $GLOBALS['_fair_test_options'] );
	}

	/** An empty week is skipped by default, and still uses the send week. */
	public function test_empty_week_is_skipped() {
		$this->events->empty = true;

		$run = $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'skipped_empty', $run['status'] );
		$this->assertSame( array(), $this->adapter->sent );
		$this->assertSame( 'skipped', $this->log->rows['bulk_email|2026-10-05|bulk_email|subscribers|1']['state'] );
		$this->assertNull( $this->process( '2026-W41', self::settings(), self::moment( '2026-10-06 08:00' ) ) );
	}

	/** With skipping off, an empty week is still emailed. */
	public function test_empty_week_is_sent_when_skipping_is_off() {
		$this->events->empty = true;

		$run = $this->process( '2026-W41', self::settings( array( 'skip_empty' => false ) ), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'sent', $run['status'] );
		$this->assertCount( 1, $this->adapter->sent );
	}

	/** A send that stopped with an error is recorded and never repeated. */
	public function test_failed_send_is_not_repeated() {
		$this->adapter->throw = true;

		$run = $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'failed', $run['status'] );
		$this->assertSame( 'uncertain', $this->log->rows['bulk_email|2026-10-05|bulk_email|subscribers|1']['state'] );

		$this->adapter->throw = false;
		$this->assertNull( $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:05' ) ) );
		$this->assertSame( array(), $this->adapter->sent );
	}

	/** An unknown event source is a configuration error, not a send. */
	public function test_missing_source_is_a_configuration_error() {
		$this->events->error = true;

		$run = $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'configuration_error', $run['status'] );
		$this->assertSame( 'The selected event feed does not exist or is disabled.', $run['message'] );
		$this->assertSame( array(), $this->adapter->sent );
	}

	/** The email goes only to the subscribers of the feed it lists. */
	public function test_sends_to_the_listed_feed_only() {
		$this->events->source_id = 9;

		$this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 9, $this->adapter->sent[0][2] );
	}

	/** Without a feed to name, nothing is sent rather than everyone. */
	public function test_week_without_a_feed_is_a_configuration_error() {
		$this->events->source_id = 0;

		$run = $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'configuration_error', $run['status'] );
		$this->assertSame( array(), $this->adapter->sent );
		$this->assertSame( 'failed', $this->log->rows['bulk_email|2026-10-05|bulk_email|subscribers|1']['state'] );
	}

	/** The events week is the send week or the one after, across a year boundary. */
	public function test_event_week_follows_the_scope_across_years() {
		$now = self::moment( '2026-12-28 08:00' );

		$this->assertSame( '2026-W53', BulkEmailDispatcher::iso_week( $now ) );
		$this->assertSame( array( 2026, 53 ), BulkEmailDispatcher::event_week( 'current', $now ) );
		$this->assertSame( array( 2027, 1 ), BulkEmailDispatcher::event_week( 'next', $now ) );

		$this->process( '2026-W53', self::settings( array( 'week_scope' => 'next' ) ), $now );
		$this->assertSame( array( 'members', '2027-01-04', '2027-01-10' ), $this->events->requests[0] );
		$this->assertSame( '2026-12-28', BulkEmailDispatcher::week_start( '2026-W53' ) );
	}

	/** The send week is judged in the site timezone, not in UTC. */
	public function test_send_week_uses_the_site_timezone() {
		// Monday 00:30 in Madrid is still Sunday in UTC.
		$now = self::moment( '2026-10-05 00:30', 'Europe/Madrid' );

		$this->assertSame( '2026-W41', BulkEmailDispatcher::iso_week( $now ) );
		$this->assertSame( 'sent', $this->process( '2026-W41', self::settings(), $now )['status'] );
	}

	/** Immediate email selection retains the local week when UTC has rolled over. */
	public function test_immediate_event_week_at_local_year_boundary() {
		$now = self::moment( '2027-01-03 23:30', 'America/Los_Angeles' );
		$this->assertSame( array( 2026, 53 ), BulkEmailDispatcher::event_week( 'current', $now ) );
		$this->assertSame( array( 2027, 1 ), BulkEmailDispatcher::event_week( 'next', $now ) );
		$this->assertSame( array( 2027, 1 ), BulkEmailDispatcher::event_week( 'current', $now->setTimezone( new \DateTimeZone( 'UTC' ) ) ) );
	}

	/** The next send skips a send week that is already used. */
	public function test_next_due_skips_a_used_send_week() {
		$settings = self::settings(
			array(
				'day_of_week' => 5,
				'time_of_day' => '10:00',
			)
		);
		$after    = self::moment( '2026-10-05 09:00' );

		$this->assertSame( '2026-10-09 10:00', BulkEmailDispatcher::next_due( $settings, $after, '' )->format( 'Y-m-d H:i' ) );
		$this->assertSame( '2026-10-16 10:00', BulkEmailDispatcher::next_due( $settings, $after, '2026-W41' )->format( 'Y-m-d H:i' ) );
	}

	/** Changing the schedule queues the next future send only. */
	public function test_reschedule_queues_one_future_send() {
		BulkEmailDispatcher::reschedule( 'bulk_email', self::settings() );

		$events = $GLOBALS['_fair_test_cron'][ BulkEmailDispatcher::HOOK ];
		$this->assertCount( 1, $events );
		$this->assertGreaterThan( time(), $events[0][0] );
		$this->assertSame( $events[0][1][0], BulkEmailDispatcher::next_run( 'bulk_email' )['send_week'] );

		BulkEmailDispatcher::reschedule( 'bulk_email', self::settings( array( 'enabled' => false ) ) );
		$this->assertEmpty( $GLOBALS['_fair_test_cron'][ BulkEmailDispatcher::HOOK ] ?? array() );
		$this->assertNull( BulkEmailDispatcher::next_run( 'bulk_email' ) );
	}

	/** Invalid send weeks are refused. */
	public function test_invalid_send_week_is_ignored() {
		$this->assertNull( BulkEmailDispatcher::week_start( '2026-10-05' ) );
		$this->assertNull( $this->process( 'nonsense', self::settings(), self::moment( '2026-10-05 08:00' ) ) );
	}

	/** Two configurations both send to subscribers in the same week, once each. */
	public function test_two_configurations_both_send_once_in_the_same_week() {
		$dispatcher = new BulkEmailDispatcher( $this->log, $this->adapter, $this->events );
		$now        = self::moment( '2026-10-05 08:00' );

		$this->assertSame( 'sent', $dispatcher->process( 'members', '2026-W41', self::settings(), $now )['status'] );
		$this->assertSame( 'sent', $dispatcher->process( 'public', '2026-W41', self::settings(), $now )['status'] );
		$this->assertNull( $dispatcher->process( 'members', '2026-W41', self::settings(), $now ) );
		$this->assertNull( $dispatcher->process( 'public', '2026-W41', self::settings(), $now ) );

		$this->assertCount( 2, $this->adapter->sent );
		$this->assertCount( 1, BulkEmailDispatcher::runs( 'members' ) );
		$this->assertCount( 1, BulkEmailDispatcher::runs( 'public' ) );
	}

	/** Pausing one configuration removes only its queued send. */
	public function test_pausing_one_configuration_leaves_the_others_scheduled() {
		BulkEmailDispatcher::reschedule( 'members', self::settings() );
		BulkEmailDispatcher::reschedule( 'public', self::settings() );
		$public = BulkEmailDispatcher::next_run( 'public' );

		BulkEmailDispatcher::reschedule( 'members', self::settings( array( 'enabled' => false ) ) );

		$this->assertNull( BulkEmailDispatcher::next_run( 'members' ) );
		$this->assertSame( $public, BulkEmailDispatcher::next_run( 'public' ) );
		$this->assertCount( 1, $GLOBALS['_fair_test_cron'][ BulkEmailDispatcher::HOOK ] );
	}
}
