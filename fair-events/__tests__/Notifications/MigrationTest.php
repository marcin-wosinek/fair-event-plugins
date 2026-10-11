<?php
/**
 * Migration tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\BulkEmailDispatcher;
use FairEvents\Notifications\BulkEmailSettings;
use FairEvents\Notifications\Migration;
use FairEvents\Notifications\TelegramDispatcher;
use FairEvents\Notifications\TelegramSettings;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fakes/FakeDeliveryLog.php';

/**
 * Taking notification settings and history over from their former owners.
 */
class MigrationTest extends TestCase {
	private const TOKEN = '123456789:AAEabcdefghijklmnopqrstuvwxyz012345';

	/**
	 * Delivery record.
	 *
	 * @var FakeDeliveryLog
	 */
	private $log;

	/**
	 * Start from an empty site.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
		$GLOBALS['_fair_test_cron']    = array();
		$this->log                     = new FakeDeliveryLog();
	}

	/**
	 * Legacy Telegram settings as Fair Events Experimental saved them.
	 *
	 * @param bool $enabled Whether weekly notifications were on.
	 * @return array
	 */
	private static function legacy_telegram( $enabled = true ) {
		return array(
			'enabled'     => $enabled,
			'source_slug' => 'city-events',
			'page_id'     => 12,
			'day_of_week' => 5,
			'time_of_day' => '10:30',
			'week_scope'  => 'next',
			'providers'   => array(
				'telegram' => array(
					'enabled'  => true,
					'chat_ids' => array( '@city_events', '-1001234567890' ),
				),
			),
		);
	}

	/**
	 * Seed a site that used the Telegram summary.
	 *
	 * @return void
	 */
	private function seed_telegram() {
		$GLOBALS['_fair_test_options'][ Migration::LEGACY_TELEGRAM_OPTION ]   = self::legacy_telegram();
		$GLOBALS['_fair_test_options'][ TelegramSettings::TOKEN_OPTION ]      = self::TOKEN;
		$GLOBALS['_fair_test_options'][ Migration::LEGACY_TELEGRAM_RUNS ]     = array(
			'2026-09-14' => array(
				'week_start' => '2026-09-14',
				'week_end'   => '2026-09-20',
				'status'     => 'sent',
			),
		);
		$GLOBALS['_fair_test_options'][ Migration::LEGACY_TELEGRAM_NEXT_RUN ] = array(
			'timestamp'  => 1,
			'week_start' => '2026-09-21',
		);
		$GLOBALS['_fair_test_cron'][ Migration::LEGACY_TELEGRAM_HOOK ]        = array( array( 1, array( '2026-09-21' ) ) );
	}

	/** A site without notifications gets no settings written. */
	public function test_fresh_site_gets_nothing_written() {
		Migration::telegram( $this->log );
		Migration::bulk_email( $this->log );

		$this->assertSame( array(), $GLOBALS['_fair_test_options'] );
		$this->assertSame( array(), $this->log->rows );
	}

	/** Telegram settings, schedule, chats and run history are copied; the token stays where it is. */
	public function test_telegram_settings_and_history_are_copied() {
		$this->seed_telegram();

		Migration::telegram( $this->log );

		$settings = TelegramSettings::get();
		$this->assertSame( 'city-events', $settings['source_slug'] );
		$this->assertSame( 12, $settings['page_id'] );
		$this->assertSame( 5, $settings['day_of_week'] );
		$this->assertSame( '10:30', $settings['time_of_day'] );
		$this->assertSame( 'next', $settings['week_scope'] );
		$this->assertSame( array( '@city_events', '-1001234567890' ), $settings['providers']['telegram']['chat_ids'] );
		$this->assertTrue( $settings['providers']['telegram']['enabled'] );
		$this->assertSame( 'sent', TelegramDispatcher::runs()[0]['status'] );
		$this->assertSame( self::TOKEN, $GLOBALS['_fair_test_options'][ TelegramSettings::TOKEN_OPTION ] );
	}

	/** The former sender is switched off and its queued job removed; nothing new is scheduled or sent. */
	public function test_telegram_legacy_sender_is_retired_without_sending() {
		$this->seed_telegram();
		$GLOBALS['_fair_test_remote_post_requests'] = array();

		Migration::telegram( $this->log );

		$this->assertFalse( $GLOBALS['_fair_test_options'][ Migration::LEGACY_TELEGRAM_OPTION ]['enabled'] );
		$this->assertArrayNotHasKey( Migration::LEGACY_TELEGRAM_HOOK, $GLOBALS['_fair_test_cron'] );
		$this->assertArrayNotHasKey( Migration::LEGACY_TELEGRAM_NEXT_RUN, $GLOBALS['_fair_test_options'] );
		$this->assertArrayNotHasKey( TelegramDispatcher::HOOK, $GLOBALS['_fair_test_cron'] );
		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
	}

	/** A summary that was not being sent (its plugin was inactive) arrives turned off. */
	public function test_telegram_that_was_not_running_arrives_turned_off() {
		$this->seed_telegram();

		$details = Migration::telegram( $this->log );

		$this->assertFalse( TelegramSettings::get()['enabled'] );
		$this->assertSame(
			array(
				'legacy_enabled' => true,
				'kept_enabled'   => false,
			),
			$details
		);
	}

	/**
	 * A summary an active, updated Fair Events Experimental was sending stays on.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 */
	public function test_telegram_that_was_running_stays_on() {
		define( 'FAIR_EVENTS_EXPERIMENTAL_VERSION', '1.12.0' );
		define( 'FAIR_EVENTS_EXPERIMENTAL_NOTIFICATIONS_HANDOFF', true );
		$GLOBALS['_fair_test_options'] = array();
		$GLOBALS['_fair_test_cron']    = array();
		$this->seed_telegram();

		Migration::telegram( new FakeDeliveryLog() );

		$this->assertTrue( TelegramSettings::get()['enabled'] );
		$this->assertFalse( $GLOBALS['_fair_test_options'][ Migration::LEGACY_TELEGRAM_OPTION ]['enabled'] );
	}

	/** Running the takeover again keeps what was edited since. */
	public function test_repeated_telegram_takeover_keeps_later_edits() {
		$this->seed_telegram();
		Migration::telegram( $this->log );

		$edited                = TelegramSettings::get();
		$edited['time_of_day'] = '18:45';
		$edited['enabled']     = true;
		TelegramSettings::save( $edited );
		$GLOBALS['_fair_test_options'][ TelegramDispatcher::RUNS_OPTION ] = array();

		Migration::telegram( $this->log );

		$this->assertSame( '18:45', TelegramSettings::get()['time_of_day'] );
		$this->assertTrue( TelegramSettings::get()['enabled'] );
		$this->assertSame( array(), TelegramDispatcher::runs() );
	}

	/** A takeover interrupted after the copy does not turn the channel off when it resumes. */
	public function test_interrupted_telegram_takeover_resumes() {
		$this->seed_telegram();
		// The first attempt copied the settings and switched the former sender off, then stopped.
		$copied            = TelegramSettings::normalize( self::legacy_telegram() );
		$copied['enabled'] = true;
		TelegramSettings::save( $copied );
		$GLOBALS['_fair_test_options'][ Migration::LEGACY_TELEGRAM_OPTION ]['enabled'] = false;

		Migration::telegram( $this->log );

		$this->assertTrue( TelegramSettings::get()['enabled'] );
		$this->assertArrayNotHasKey( Migration::LEGACY_TELEGRAM_HOOK, $GLOBALS['_fair_test_cron'] );
	}

	/**
	 * Seed a site that used the weekly digest.
	 *
	 * @return void
	 */
	private function seed_bulk_email() {
		$GLOBALS['_fair_test_options'][ Migration::LEGACY_BULK_OPTION ]      = array(
			'enabled'     => true,
			'source_slug' => 'members',
			'day_of_week' => 1,
			'time_of_day' => '08:00',
			'week_scope'  => 'current',
			'skip_empty'  => false,
			'subject'     => 'Events {week_start}',
			'intro'       => '<p>Hello</p>',
			'outro'       => 'Bye',
		);
		$GLOBALS['_fair_test_options'][ Migration::LEGACY_BULK_LAST_SENT ]   = '2026-W41';
		$GLOBALS['_fair_test_options'][ Migration::LEGACY_BULK_LAST_RESULT ] = array(
			'status'    => 'sent',
			'timestamp' => '2026-10-05 08:00:10',
			'message'   => 'Sent to 12, failed 0, skipped 3.',
		);
		$GLOBALS['_fair_test_cron'][ Migration::LEGACY_BULK_HOOK ]           = array( array( 1, array() ) );
	}

	/** The weekly email's schedule, event selection and wording are copied. */
	public function test_bulk_email_settings_are_copied() {
		$this->seed_bulk_email();

		Migration::bulk_email( $this->log );

		$settings = BulkEmailSettings::stored();
		$this->assertSame( 'members', $settings['source_slug'] );
		$this->assertSame( '08:00', $settings['time_of_day'] );
		$this->assertFalse( $settings['skip_empty'] );
		$this->assertSame( 'Events {week_start}', $settings['subject'] );
		$this->assertSame( '<p>Hello</p>', $settings['intro'] );
		$this->assertSame( 'Bye', $settings['outro'] );
	}

	/** The week already sent stays used up, and the last result stays visible. */
	public function test_bulk_email_history_is_kept() {
		$this->seed_bulk_email();

		Migration::bulk_email( $this->log );

		$this->assertSame( '2026-W41', $GLOBALS['_fair_test_options'][ BulkEmailDispatcher::LAST_SENT_OPTION ] );
		$this->assertFalse( $this->log->claim( '2026-10-05', BulkEmailDispatcher::PROVIDER, BulkEmailDispatcher::DESTINATION, 1, 1 ) );
		$runs = BulkEmailDispatcher::runs();
		$this->assertSame( '2026-W41', $runs[0]['send_week'] );
		$this->assertSame( 'sent', $runs[0]['status'] );
		$this->assertSame( 'Sent to 12, failed 0, skipped 3.', $runs[0]['message'] );
		$this->assertSame( '2026-10-05 08:00:10', $runs[0]['time'] );
	}

	/** The former sender is switched off and its recurring job removed; nothing is scheduled. */
	public function test_bulk_email_legacy_sender_is_retired() {
		$this->seed_bulk_email();

		$details = Migration::bulk_email( $this->log );

		$this->assertFalse( $GLOBALS['_fair_test_options'][ Migration::LEGACY_BULK_OPTION ]['enabled'] );
		$this->assertArrayNotHasKey( Migration::LEGACY_BULK_HOOK, $GLOBALS['_fair_test_cron'] );
		$this->assertArrayNotHasKey( BulkEmailDispatcher::HOOK, $GLOBALS['_fair_test_cron'] );
		// Fair Audience is not active here, so nothing was being sent.
		$this->assertFalse( BulkEmailSettings::stored()['enabled'] );
		$this->assertFalse( $details['kept_enabled'] );
	}

	/**
	 * A weekly email an active, updated Fair Audience was sending stays on.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 */
	public function test_bulk_email_that_was_running_stays_on() {
		define( 'FAIR_AUDIENCE_VERSION', '1.20.0' );
		define( 'FAIR_AUDIENCE_EVENT_NOTIFICATIONS_HANDOFF', true );
		$GLOBALS['_fair_test_options'] = array();
		$GLOBALS['_fair_test_cron']    = array();
		$this->seed_bulk_email();

		Migration::bulk_email( new FakeDeliveryLog() );

		$this->assertTrue( BulkEmailSettings::stored()['enabled'] );
	}

	/** Running the takeover again keeps edits and history made since. */
	public function test_repeated_bulk_email_takeover_keeps_later_state() {
		$this->seed_bulk_email();
		Migration::bulk_email( $this->log );

		$edited            = BulkEmailSettings::stored();
		$edited['subject'] = 'New subject';
		BulkEmailSettings::save( $edited );
		$GLOBALS['_fair_test_options'][ BulkEmailDispatcher::LAST_SENT_OPTION ] = '2026-W42';

		Migration::bulk_email( $this->log );

		$this->assertSame( 'New subject', BulkEmailSettings::stored()['subject'] );
		$this->assertSame( '2026-W42', $GLOBALS['_fair_test_options'][ BulkEmailDispatcher::LAST_SENT_OPTION ] );
		$this->assertCount( 1, BulkEmailDispatcher::runs() );
	}
}
