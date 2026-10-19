<?php
/**
 * Execution history recording tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\BulkEmailAdapter;
use FairEvents\Notifications\BulkEmailDispatcher;
use FairEvents\Notifications\BulkEmailSettings;
use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\HistoryOutcome;
use FairEvents\Notifications\IndividualEmailDispatcher;
use FairEvents\Notifications\IndividualEmailSettings;
use FairEvents\Notifications\TelegramDispatcher;
use FairEvents\Notifications\TelegramSettings;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fakes/FakeDeliveryLog.php';
require_once __DIR__ . '/fakes/FakeProvider.php';
require_once __DIR__ . '/fakes/FakeSummaryBuilder.php';
require_once __DIR__ . '/fakes/FakeNotificationMailer.php';
require_once __DIR__ . '/fakes/FakeIndividualEmailEvents.php';
require_once __DIR__ . '/fakes/FakeBulkEmailAdapter.php';
require_once __DIR__ . '/fakes/FakeWeeklyEvents.php';
require_once __DIR__ . '/fakes/FakeExecutionHistory.php';

/**
 * Telegram, individual email and group email record consistent executions.
 */
class ExecutionHistoryRecordingTest extends TestCase {

	/**
	 * Delivery record.
	 *
	 * @var FakeDeliveryLog
	 */
	private $log;

	/**
	 * History.
	 *
	 * @var FakeExecutionHistory
	 */
	private $history;

	/**
	 * Set up.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']  = array();
		$GLOBALS['_fair_test_cron']     = array();
		$GLOBALS['_fair_test_timezone'] = 'UTC';
		$this->log                      = new FakeDeliveryLog();
		$this->history                  = new FakeExecutionHistory();
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
	 * A moment.
	 *
	 * @param string $time Time.
	 * @return \DateTimeImmutable
	 */
	private static function moment( $time ) {
		return new \DateTimeImmutable( $time, new \DateTimeZone( 'UTC' ) );
	}

	/**
	 * Run Telegram.
	 *
	 * @param FakeProvider       $provider Provider.
	 * @param FakeSummaryBuilder $builder  Builder.
	 * @param string             $time     Now.
	 * @return array|null
	 */
	private function telegram( $provider, $builder, $time = '2026-09-14 09:00' ) {
		$settings            = TelegramSettings::defaults();
		$settings['enabled'] = true;
		return ( new TelegramDispatcher( $this->log, array( 'fake' => $provider ), $builder, $this->history ) )
			->process( 'telegram', '2026-09-14', $settings, self::moment( $time ) );
	}

	/**
	 * Builder with a summary.
	 *
	 * @param string $text  Text.
	 * @param int    $count Occurrences.
	 * @return FakeSummaryBuilder
	 */
	private static function builder( $text = 'one|two', $count = 1 ) {
		$builder         = new FakeSummaryBuilder();
		$builder->result = array(
			'text'             => $text,
			'occurrence_count' => $count,
		);
		return $builder;
	}

	/** Telegram records one delivery per message part and chat. */
	public function test_telegram_counts_message_parts() {
		$provider                  = new FakeProvider();
		$provider->split_on_marker = true;

		$this->telegram( $provider, self::builder() );

		$execution = $this->history->only();
		$this->assertSame( HistoryOutcome::SCHEDULED, $execution['origin'] );
		$this->assertSame( Configurations::TELEGRAM, $execution['channel'] );
		$this->assertSame( '2026-09-14', $execution['occurrence'] );
		$this->assertSame( '2026-09-20', $execution['week_end'] );
		$this->assertSame( HistoryOutcome::SUCCESS, $execution['outcome'] );
		$this->assertSame( 6, $execution['counts']['accepted'] );
		$this->assertSame( array( 1, 2 ), array_column( array_slice( $this->history->of( 1 ), 0, 2 ), 'part' ) );
		$this->assertSame( '@one', $this->history->of( 1 )[0]['recipient'] );
	}

	/** A failed part skips the chat's remaining parts; others succeed: partial. */
	public function test_telegram_failure_is_partial_with_skipped_parts() {
		$provider                  = new FakeProvider();
		$provider->split_on_marker = true;
		$provider->states['@one']  = 'failed';

		$this->telegram( $provider, self::builder() );

		$execution = $this->history->only();
		$this->assertSame( HistoryOutcome::PARTIAL, $execution['outcome'] );
		$this->assertSame( 4, $execution['counts']['accepted'] );
		$this->assertSame( 1, $execution['counts']['failed'] );
		$this->assertSame( 1, $execution['counts']['skipped'] );
		$this->assertSame( 'previous_part_not_sent', $this->history->of( 1 )[1]['reason_code'] );
	}

	/** A part whose send threw keeps an unknown outcome. */
	public function test_telegram_exception_is_unknown() {
		$provider               = new FakeProvider();
		$provider->destinations = array( '@one' );
		$provider->throws_for   = '@one';

		$this->telegram( $provider, self::builder( 'one' ) );

		$this->assertSame( HistoryOutcome::UNKNOWN, $this->history->only()['outcome'] );
		$this->assertSame( 'internal_error', $this->history->of( 1 )[0]['reason_code'] );
	}

	/** A repeated run of the same week adds nothing and leaves the result. */
	public function test_telegram_repeated_run_keeps_the_result() {
		$provider = new FakeProvider();
		$this->telegram( $provider, self::builder( 'one' ) );
		$this->telegram( $provider, self::builder( 'one' ), '2026-09-14 09:05' );

		$execution = $this->history->only();
		$this->assertSame( HistoryOutcome::SUCCESS, $execution['outcome'] );
		$this->assertSame( 1, $execution['concluded'] );
		$this->assertCount( 3, $this->history->of( 1 ) );
	}

	/** Skips and configuration failures are executions without deliveries. */
	public function test_telegram_skips_and_failures_are_recorded() {
		$this->telegram( new FakeProvider(), self::builder( 'one', 0 ) );
		$this->assertSame( array( HistoryOutcome::SKIPPED, 'no_events' ), array( $this->history->only()['outcome'], $this->history->only()['reason_code'] ) );

		$this->history = new FakeExecutionHistory();
		$this->log     = new FakeDeliveryLog();
		$this->telegram( new FakeProvider(), self::builder(), '2026-09-21 09:00' );
		$this->assertSame( array( HistoryOutcome::SKIPPED, 'expired' ), array( $this->history->only()['outcome'], $this->history->only()['reason_code'] ) );

		$this->history   = new FakeExecutionHistory();
		$builder         = new FakeSummaryBuilder();
		$builder->result = new \WP_Error( 'invalid_source', 'Gone.' );
		$this->telegram( new FakeProvider(), $builder );
		$this->assertSame( array( HistoryOutcome::FAILURE, 'configuration_error' ), array( $this->history->only()['outcome'], $this->history->only()['reason_code'] ) );
	}

	/**
	 * Run the individual email.
	 *
	 * @param FakeNotificationMailer $mailer Mailer.
	 * @param string                 $time   Now.
	 * @param array                  $events Events overrides.
	 * @return array|null
	 */
	private function individual( $mailer, $time = '2026-10-05 08:00', array $events = array() ) {
		$fake_events = new FakeIndividualEmailEvents();
		foreach ( $events as $key => $value ) {
			$fake_events->$key = $value;
		}
		$settings = IndividualEmailSettings::sanitize(
			array(
				'enabled'     => true,
				'recipient'   => 'organizer@example.com',
				'day_of_week' => 1,
				'time_of_day' => '08:00',
				'subject'     => 'Events',
			)
		);
		return ( new IndividualEmailDispatcher( $this->log, $mailer, $fake_events, $this->history ) )
			->process( 'individual_email', '2026-W41', $settings, self::moment( $time ) );
	}

	/** The individual email is one delivery to the saved address. */
	public function test_individual_email_records_its_recipient() {
		$this->individual( new FakeNotificationMailer() );

		$execution = $this->history->only();
		$this->assertSame( HistoryOutcome::SUCCESS, $execution['outcome'] );
		$this->assertSame( '2026-10-05', $execution['week_start'] );
		$this->assertSame( 'organizer@example.com', $this->history->of( 1 )[0]['recipient'] );
		$this->assertSame( HistoryOutcome::ACCEPTED, $this->history->of( 1 )[0]['outcome'] );
	}

	/** A refused or interrupted email is a failure or an unknown outcome. */
	public function test_individual_email_failure_and_exception() {
		$mailer       = new FakeNotificationMailer();
		$mailer->fail = true;
		$this->individual( $mailer );
		$this->assertSame( HistoryOutcome::FAILURE, $this->history->only()['outcome'] );
		$this->assertSame( 'send_failed', $this->history->of( 1 )[0]['reason_code'] );

		$this->history = new FakeExecutionHistory();
		$this->log     = new FakeDeliveryLog();
		$mailer        = new FakeNotificationMailer();
		$mailer->throw = true;
		$this->individual( $mailer );
		$this->assertSame( HistoryOutcome::UNKNOWN, $this->history->only()['outcome'] );
	}

	/** A stale run after the week was sent does not turn the result into an expiry. */
	public function test_individual_email_late_repeat_is_not_a_misleading_skip() {
		$this->individual( new FakeNotificationMailer() );
		$this->individual( new FakeNotificationMailer(), '2026-10-12 08:00' );

		$this->assertSame( HistoryOutcome::SUCCESS, $this->history->only()['outcome'] );
	}

	/** An empty week is a skip; a missing feed is a failure. */
	public function test_individual_email_skip_and_configuration_error() {
		$this->individual( new FakeNotificationMailer(), '2026-10-05 08:00', array( 'empty' => true ) );
		$this->assertSame( array( HistoryOutcome::SKIPPED, 'no_events' ), array( $this->history->only()['outcome'], $this->history->only()['reason_code'] ) );

		$this->history = new FakeExecutionHistory();
		$this->log     = new FakeDeliveryLog();
		$this->individual( new FakeNotificationMailer(), '2026-10-05 08:00', array( 'error' => true ) );
		$this->assertSame( array( HistoryOutcome::FAILURE, 'configuration_error' ), array( $this->history->only()['outcome'], $this->history->only()['reason_code'] ) );
	}

	/**
	 * Run the group email.
	 *
	 * @param FakeBulkEmailAdapter $adapter Adapter.
	 * @return array|null
	 */
	private function bulk( $adapter ) {
		$settings = BulkEmailSettings::sanitize(
			array(
				'enabled'     => true,
				'source_slug' => 'members',
				'day_of_week' => 1,
				'time_of_day' => '08:00',
				'subject'     => 'Events',
			)
		);
		return ( new BulkEmailDispatcher( $this->log, $adapter, new FakeWeeklyEvents(), $this->history ) )
			->process( 'bulk_email', '2026-W41', $settings, self::moment( '2026-10-05 08:00' ) );
	}

	/**
	 * A recipient report.
	 *
	 * @param string $event  Event.
	 * @param int    $id     Participant ID.
	 * @param string $reason Reason.
	 * @return array
	 */
	private static function report( $event, $id, $reason = '' ) {
		$recipient = array(
			'id'    => $id,
			'name'  => 'Person ' . $id,
			'email' => "p{$id}@example.test",
		);
		if ( $reason ) {
			$recipient['reason'] = $reason;
		}
		return array( $event, $recipient );
	}

	/** The group email records each recipient and aggregates them. */
	public function test_group_email_exposes_each_recipient() {
		$adapter          = new FakeBulkEmailAdapter();
		$adapter->reports = array(
			self::report( 'sending', 1 ),
			self::report( 'sent', 1 ),
			self::report( 'skipped', 2, 'marketing_opt_out' ),
			self::report( 'sending', 3 ),
			self::report( 'sent', 3 ),
		);

		$this->bulk( $adapter );

		$execution = $this->history->only();
		$this->assertSame( HistoryOutcome::SUCCESS, $execution['outcome'] );
		$this->assertSame( 2, $execution['counts']['accepted'] );
		$this->assertSame( 1, $execution['counts']['skipped'] );
		$this->assertSame( array( 'p1@example.test', 'p2@example.test', 'p3@example.test' ), array_column( $this->history->of( 1 ), 'recipient' ) );
	}

	/** Recipients completed before the send stopped keep their outcome; the one in flight is unknown. */
	public function test_group_email_interruption_keeps_completed_results() {
		$adapter                      = new FakeBulkEmailAdapter();
		$adapter->reports             = array(
			self::report( 'sending', 1 ),
			self::report( 'sent', 1 ),
			self::report( 'sending', 2 ),
			self::report( 'sent', 2 ),
		);
		$adapter->throw_after_reports = 3;

		$run = $this->bulk( $adapter );

		$this->assertSame( 'failed', $run['status'] );
		$execution = $this->history->only();
		$this->assertSame( HistoryOutcome::PARTIAL, $execution['outcome'] );
		$this->assertSame( array( HistoryOutcome::ACCEPTED, HistoryOutcome::UNKNOWN ), array_column( $this->history->of( 1 ), 'outcome' ) );
	}

	/** Fair Audience unable to report recipients: the send waits for its update. */
	public function test_group_email_requires_reporting_fair_audience() {
		$adapter               = new FakeBulkEmailAdapter();
		$adapter->availability = BulkEmailAdapter::UPDATE_REQUIRED;

		$run = $this->bulk( $adapter );

		$this->assertSame( 'suspended', $run['status'] );
		$this->assertSame( array(), $adapter->sent );
		$this->assertSame( array( HistoryOutcome::SKIPPED, 'fair_audience_update_required' ), array( $this->history->only()['outcome'], $this->history->only()['reason_code'] ) );
	}

	/** Nobody eligible at all is a skip. */
	public function test_group_email_without_recipients_is_skipped() {
		$this->bulk( new FakeBulkEmailAdapter() );

		$this->assertSame( array( HistoryOutcome::SKIPPED, 'no_recipients' ), array( $this->history->only()['outcome'], $this->history->only()['reason_code'] ) );
	}
}
