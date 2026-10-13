<?php
/**
 * IndividualEmailDispatcher tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\BulkEmailDispatcher;
use FairEvents\Notifications\IndividualEmailDispatcher;
use FairEvents\Notifications\IndividualEmailSettings;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fakes/FakeDeliveryLog.php';
require_once __DIR__ . '/fakes/FakeNotificationMailer.php';
require_once __DIR__ . '/fakes/FakeIndividualEmailEvents.php';

/**
 * Individual email delivery: to one address, at most once per send week,
 * never replayed.
 */
class IndividualEmailDispatcherTest extends TestCase {

	private const LOG_KEY = '2026-10-05|individual_email|recipient|1';

	/**
	 * Delivery record.
	 *
	 * @var FakeDeliveryLog
	 */
	private $log;

	/**
	 * Mail transport double.
	 *
	 * @var FakeNotificationMailer
	 */
	private $mailer;

	/**
	 * Events double.
	 *
	 * @var FakeIndividualEmailEvents
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
		$this->mailer                   = new FakeNotificationMailer();
		$this->events                   = new FakeIndividualEmailEvents();
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
		return IndividualEmailSettings::sanitize(
			array_merge(
				array(
					'enabled'     => true,
					'recipient'   => 'organizer@example.com',
					'day_of_week' => 1,
					'time_of_day' => '08:00',
					'subject'     => 'Events {week_start}',
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
		return ( new IndividualEmailDispatcher( $this->log, $this->mailer, $this->events ) )->process( $send_week, $settings, $now );
	}

	/** The email goes to the configured address only, and the run says where. */
	public function test_sends_to_the_configured_address_only() {
		$run = $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'sent', $run['status'] );
		$this->assertSame( 'organizer@example.com', $run['destination'] );
		$this->assertSame( '2026-10-05', $run['week_start'] );
		$this->assertSame( '2026-10-11', $run['week_end'] );
		$this->assertStringContainsString( 'does not confirm', $run['message'] );
		$this->assertCount( 1, $this->mailer->sent );
		$this->assertSame( 'organizer@example.com', $this->mailer->sent[0][0] );
		$this->assertSame( 'Events 2026-10-05', $this->mailer->sent[0][1] );
		$this->assertStringContainsString( 'Concert', $this->mailer->sent[0][2] );
		$this->assertSame( '2026-W41', $GLOBALS['_fair_test_options'][ IndividualEmailDispatcher::LAST_SENT_OPTION ] );
		$this->assertSame( 'sent', $this->log->rows[ self::LOG_KEY ]['state'] );
		$this->assertSame( array( IndividualEmailSettings::LOCAL_EVENTS, '2026-10-05', '2026-10-11' ), $this->events->requests[0] );
	}

	/** Overlapping or repeated cron runs for one send week send once. */
	public function test_second_run_for_the_same_send_week_sends_nothing() {
		$this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertNull( $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) ) );
		$this->assertCount( 1, $this->mailer->sent );
	}

	/** Changing the address or schedule after an attempt cannot send again that week. */
	public function test_changed_address_or_schedule_does_not_send_again_that_week() {
		$this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$changed = self::settings(
			array(
				'recipient'   => 'other@example.com',
				'day_of_week' => 3,
				'time_of_day' => '10:00',
			)
		);
		$this->assertNull( $this->process( '2026-W41', $changed, self::moment( '2026-10-07 10:00' ) ) );
		$this->assertCount( 1, $this->mailer->sent );

		// The next send is in the following week, to the new address.
		$this->assertSame(
			'2026-10-14 10:00',
			IndividualEmailDispatcher::next_due( $changed, self::moment( '2026-10-05 08:01' ), '2026-W41' )->format( 'Y-m-d H:i' )
		);
		$this->assertSame( 'other@example.com', $this->process( '2026-W42', $changed, self::moment( '2026-10-14 10:00' ) )['destination'] );
	}

	/** A send that ran a week late is dropped, not replayed. */
	public function test_late_run_in_another_week_is_not_replayed() {
		$run = $this->process( '2026-W41', self::settings(), self::moment( '2026-10-12 08:00' ) );

		$this->assertSame( 'expired', $run['status'] );
		$this->assertSame( array(), $this->mailer->sent );
		$this->assertSame( array(), $this->log->rows );
	}

	/** A turned-off channel does nothing, even for a queued job. */
	public function test_disabled_channel_does_nothing() {
		$this->assertNull( $this->process( '2026-W41', self::settings( array( 'enabled' => false ) ), self::moment( '2026-10-05 08:00' ) ) );
		$this->assertSame( array(), $this->mailer->sent );
		$this->assertSame( array(), $GLOBALS['_fair_test_options'] );
	}

	/** An empty week is skipped by default, and still uses the send week. */
	public function test_empty_week_is_skipped() {
		$this->events->empty = true;

		$run = $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'skipped_empty', $run['status'] );
		$this->assertSame( array(), $this->mailer->sent );
		$this->assertSame( 'skipped', $this->log->rows[ self::LOG_KEY ]['state'] );
		$this->assertNull( $this->process( '2026-W41', self::settings(), self::moment( '2026-10-06 08:00' ) ) );
	}

	/** With skipping off, an empty week is emailed with an explicit message. */
	public function test_empty_week_is_sent_when_skipping_is_off() {
		$this->events->empty = true;

		$run = $this->process( '2026-W41', self::settings( array( 'skip_empty' => false ) ), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'sent', $run['status'] );
		$this->assertCount( 1, $this->mailer->sent );
		$this->assertStringContainsString( 'No events are scheduled for', $this->mailer->sent[0][2] );
	}

	/** An email the mail system refused is a visible failure and is not repeated. */
	public function test_refused_email_is_a_visible_failure() {
		$this->mailer->fail = true;

		$run = $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'failed', $run['status'] );
		$this->assertSame( 'organizer@example.com', $run['destination'] );
		$this->assertSame( 'failed', $this->log->rows[ self::LOG_KEY ]['state'] );
		$this->assertSame( $run, IndividualEmailDispatcher::runs()[0] );

		$this->mailer->fail = false;
		$this->assertNull( $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:05' ) ) );
		$this->assertSame( array(), $this->mailer->sent );
	}

	/** A send that stopped with an error is uncertain and never repeated. */
	public function test_failed_send_is_not_repeated() {
		$this->mailer->throw = true;

		$run = $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'failed', $run['status'] );
		$this->assertSame( 'uncertain', $this->log->rows[ self::LOG_KEY ]['state'] );

		$this->mailer->throw = false;
		$this->assertNull( $this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:05' ) ) );
		$this->assertSame( array(), $this->mailer->sent );
	}

	/** A failure here leaves the other channels' state untouched. */
	public function test_failure_does_not_touch_other_channels() {
		$GLOBALS['_fair_test_options'][ BulkEmailDispatcher::RUNS_OPTION ]      = array( '2026-W41' => array( 'status' => 'sent' ) );
		$GLOBALS['_fair_test_options'][ BulkEmailDispatcher::LAST_SENT_OPTION ] = '2026-W41';
		$this->log->claim( '2026-10-05', BulkEmailDispatcher::PROVIDER, BulkEmailDispatcher::DESTINATION, 1, 1 );
		$this->mailer->throw = true;

		$this->process( '2026-W41', self::settings(), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( array( '2026-W41' => array( 'status' => 'sent' ) ), $GLOBALS['_fair_test_options'][ BulkEmailDispatcher::RUNS_OPTION ] );
		$this->assertSame( '2026-W41', $GLOBALS['_fair_test_options'][ BulkEmailDispatcher::LAST_SENT_OPTION ] );
		$this->assertSame( 'sending', $this->log->rows['2026-10-05|bulk_email|subscribers|1']['state'] );
	}

	/** A deleted or disabled source is a configuration error, never a wider selection. */
	public function test_missing_source_is_a_configuration_error() {
		$this->events->error = true;

		$run = $this->process( '2026-W41', self::settings( array( 'event_selection' => 'members' ) ), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'configuration_error', $run['status'] );
		$this->assertSame( 'The selected event source does not exist or is disabled.', $run['message'] );
		$this->assertSame( 'members', $this->events->requests[0][0] );
		$this->assertSame( array(), $this->mailer->sent );
	}

	/** A recipient that is no longer valid is a configuration error. */
	public function test_missing_recipient_is_a_configuration_error() {
		$settings              = self::settings();
		$settings['recipient'] = "a@example.com\nBcc: b@example.com";

		$run = $this->process( '2026-W41', $settings, self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( 'configuration_error', $run['status'] );
		$this->assertSame( array(), $this->mailer->sent );
		$this->assertSame( array(), $this->events->requests );
	}

	/** The events week is Monday to Sunday, across a year boundary. */
	public function test_event_week_follows_the_scope_across_years() {
		$now = self::moment( '2026-12-28 08:00' );

		$this->assertSame(
			array(
				'start' => '2026-12-28',
				'end'   => '2027-01-03',
			),
			IndividualEmailDispatcher::event_week( 'current', $now )
		);
		$this->assertSame(
			array(
				'start' => '2027-01-04',
				'end'   => '2027-01-10',
			),
			IndividualEmailDispatcher::event_week( 'next', $now )
		);

		$this->process( '2026-W53', self::settings( array( 'week_scope' => 'next' ) ), $now );
		$this->assertSame( array( IndividualEmailSettings::LOCAL_EVENTS, '2027-01-04', '2027-01-10' ), $this->events->requests[0] );
	}

	/** Immediate email dates stay in the local week across the ISO year boundary. */
	public function test_immediate_event_week_at_local_year_boundary() {
		$now = self::moment( '2027-01-03 23:30', 'America/Los_Angeles' );
		$this->assertSame(
			array(
				'start' => '2026-12-28',
				'end'   => '2027-01-03',
			),
			IndividualEmailDispatcher::event_week( 'current', $now )
		);
		$this->assertSame(
			array(
				'start' => '2027-01-04',
				'end'   => '2027-01-10',
			),
			IndividualEmailDispatcher::event_week( 'next', $now )
		);
	}

	/** The send week is judged in the site timezone, not in UTC. */
	public function test_send_week_uses_the_site_timezone() {
		// Monday 00:30 in Madrid is still Sunday in UTC.
		$now = self::moment( '2026-10-05 00:30', 'Europe/Madrid' );

		$this->assertSame( 'sent', $this->process( '2026-W41', self::settings(), $now )['status'] );
	}

	/** The send time stays on the wall clock across a daylight-saving change. */
	public function test_send_time_follows_daylight_saving() {
		$settings = self::settings( array( 'time_of_day' => '08:00' ) );
		// Clocks in Madrid go back on Sunday 25 October 2026.
		$before = self::moment( '2026-10-19 08:00', 'Europe/Madrid' );

		$due = IndividualEmailDispatcher::next_due( $settings, $before, '2026-W43' );

		$this->assertSame( '2026-10-26 08:00', $due->format( 'Y-m-d H:i' ) );
		$this->assertSame( '+01:00', $due->format( 'P' ) );
		$this->assertSame( 7 * DAY_IN_SECONDS + HOUR_IN_SECONDS, $due->getTimestamp() - $before->getTimestamp() );
	}

	/** Its schedule is its own: other channels' cron hooks are not touched. */
	public function test_reschedule_queues_one_future_send_of_its_own() {
		$GLOBALS['_fair_test_cron'][ BulkEmailDispatcher::HOOK ] = array( array( time() + 60, array( '2026-W41' ) ) );

		IndividualEmailDispatcher::reschedule( self::settings() );

		$events = $GLOBALS['_fair_test_cron'][ IndividualEmailDispatcher::HOOK ];
		$this->assertCount( 1, $events );
		$this->assertGreaterThan( time(), $events[0][0] );
		$this->assertSame( $events[0][1][0], IndividualEmailDispatcher::next_run()['send_week'] );

		IndividualEmailDispatcher::reschedule( self::settings( array( 'enabled' => false ) ) );
		$this->assertArrayNotHasKey( IndividualEmailDispatcher::HOOK, $GLOBALS['_fair_test_cron'] );
		$this->assertNull( IndividualEmailDispatcher::next_run() );
		$this->assertCount( 1, $GLOBALS['_fair_test_cron'][ BulkEmailDispatcher::HOOK ] );
	}

	/** Turning the channel back on schedules a future send, not a missed one. */
	public function test_reactivation_does_not_replay_a_missed_week() {
		$GLOBALS['_fair_test_options'][ IndividualEmailDispatcher::LAST_SENT_OPTION ] = '2026-W30';

		IndividualEmailDispatcher::reschedule( self::settings() );

		$next = IndividualEmailDispatcher::next_run();
		$this->assertGreaterThan( time(), $next['timestamp'] );
		$this->assertSame( array(), $this->mailer->sent );
		$this->assertSame( array(), IndividualEmailDispatcher::runs() );
	}

	/** Run history is bounded. */
	public function test_run_history_is_bounded() {
		for ( $week = 1; $week <= 12; $week++ ) {
			$send_week = sprintf( '2026-W%02d', $week );
			$this->process( $send_week, self::settings(), self::moment( BulkEmailDispatcher::week_start( $send_week ) . ' 08:00' ) );
		}

		$runs = IndividualEmailDispatcher::runs();
		$this->assertCount( 10, $runs );
		$this->assertSame( '2026-W12', $runs[0]['send_week'] );
	}

	/** Invalid send weeks are refused. */
	public function test_invalid_send_week_is_ignored() {
		$this->assertNull( $this->process( 'nonsense', self::settings(), self::moment( '2026-10-05 08:00' ) ) );
	}
}
