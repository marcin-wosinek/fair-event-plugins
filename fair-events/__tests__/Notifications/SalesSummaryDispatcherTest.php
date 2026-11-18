<?php
/**
 * SalesSummaryDispatcher tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\HistoryOutcome;
use FairEvents\Notifications\SalesSummaryDispatcher;
use FairEvents\Notifications\SalesSummaryReport;
use FairEvents\Notifications\SalesSummarySettings;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fakes/FakeDeliveryLog.php';
require_once __DIR__ . '/fakes/FakeNotificationMailer.php';
require_once __DIR__ . '/fakes/FakeExecutionHistory.php';
require_once __DIR__ . '/fakes/FakeSalesOrganizers.php';
require_once __DIR__ . '/fakes/FakeSalesStatistics.php';
require_once __DIR__ . '/fakes/FakeSelectiveMailer.php';

/**
 * Sales summary routing and delivery: each organizer gets only its own
 * events, the central report gets every organizer, each address once,
 * the fallback when an organizer has none, and nothing is repeated.
 */
class SalesSummaryDispatcherTest extends TestCase {

	private const ALPHA = '11111111-1111-4111-8111-111111111111';
	private const BETA  = '22222222-2222-4222-8222-222222222222';

	/**
	 * Delivery record.
	 *
	 * @var FakeDeliveryLog
	 */
	private $log;

	/**
	 * Mail transport.
	 *
	 * @var FakeSelectiveMailer
	 */
	private $mailer;

	/**
	 * Sales figures.
	 *
	 * @var FakeSalesStatistics
	 */
	private $statistics;

	/**
	 * Organizers.
	 *
	 * @var FakeSalesOrganizers
	 */
	private $organizers;

	/**
	 * History.
	 *
	 * @var FakeExecutionHistory
	 */
	private $history;

	/**
	 * Set up two additional organizers with an event each, and one
	 * default event.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']  = array();
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';
		$this->log                      = new FakeDeliveryLog();
		$this->mailer                   = new FakeSelectiveMailer();
		$this->history                  = new FakeExecutionHistory();
		$this->statistics               = new FakeSalesStatistics();
		$this->statistics->events       = array(
			FakeSalesStatistics::event( 10, 'Alpha concert', 4, 80.0 ),
			FakeSalesStatistics::event( 20, 'Beta workshop', 2, 30.0 ),
			FakeSalesStatistics::event( 30, 'Site meetup', 1, 0.0 ),
		);
		$this->organizers               = new FakeSalesOrganizers(
			array(
				array(
					'id'                  => 'default',
					'name'                => 'Site',
					'notification_emails' => array( 'site@example.com' ),
				),
				array(
					'id'                  => self::ALPHA,
					'name'                => 'Alpha',
					'notification_emails' => array( 'a1@example.com', 'A1@Example.com', 'a2@example.com' ),
				),
				array(
					'id'                  => self::BETA,
					'name'                => 'Beta',
					'notification_emails' => array(),
				),
			),
			array(
				10 => self::ALPHA,
				20 => self::BETA,
				30 => 'default',
			)
		);
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
	 * @param string $frequency Frequency.
	 * @return array
	 */
	private static function settings( $frequency = 'daily' ) {
		return SalesSummarySettings::sanitize(
			array(
				'frequency'      => $frequency,
				'time_of_day'    => '08:00',
				'day_of_week'    => 3,
				'fallback_email' => 'fallback@example.com',
			)
		);
	}

	/**
	 * A moment in the site timezone.
	 *
	 * @param string $time Local time.
	 * @return \DateTimeImmutable
	 */
	private static function moment( $time ) {
		return new \DateTimeImmutable( $time, new \DateTimeZone( 'Europe/Madrid' ) );
	}

	/**
	 * Run a send.
	 *
	 * @param string $key        Report.
	 * @param string $frequency  Frequency.
	 * @param string $occurrence Occurrence.
	 * @param string $now        Local time.
	 * @param array  $settings   Settings, enabled by default.
	 * @return array|null
	 */
	private function process( $key, $frequency = 'daily', $occurrence = '2026-11-18', $now = '2026-11-18 08:00', $settings = null ) {
		return ( new SalesSummaryDispatcher( $this->log, $this->mailer, $this->statistics, $this->organizers, $this->history ) )
			->process( $key, $frequency, $occurrence, $settings ?? self::settings( $frequency ), self::moment( $now ) );
	}

	/**
	 * Sent emails by recipient.
	 *
	 * @return array<string, array>
	 */
	private function sent_by_recipient() {
		$sent = array();
		foreach ( $this->mailer->sent as $email ) {
			$sent[ $email[0] ] = $email;
		}
		return $sent;
	}

	/** Two organizers each receive only their own events. */
	public function test_each_organizer_receives_only_its_own_events() {
		$this->process( self::ALPHA );
		$this->process( self::BETA );

		$sent = $this->sent_by_recipient();
		$this->assertStringContainsString( 'Alpha concert', $sent['a1@example.com'][2] );
		$this->assertStringNotContainsString( 'Beta workshop', $sent['a1@example.com'][2] );
		$this->assertStringNotContainsString( 'Site meetup', $sent['a1@example.com'][2] );
		$this->assertStringContainsString( 'Beta workshop', $sent['fallback@example.com'][2] );
		$this->assertStringNotContainsString( 'Alpha concert', $sent['fallback@example.com'][2] );
		$this->assertStringStartsWith( 'Sales summary for Alpha: ', $sent['a1@example.com'][1] );
	}

	/** Duplicate addresses get one email each, sent separately, never with other addresses. */
	public function test_duplicate_addresses_receive_one_separate_email() {
		$run = $this->process( self::ALPHA );

		$this->assertSame( array( 'a1@example.com', 'a2@example.com' ), array_column( $this->mailer->sent, 0 ) );
		$this->assertSame( 'sent', $run['status'] );
		$this->assertSame( 2, $run['sent'] );
		$this->assertFalse( $run['fallback'] );
		foreach ( $this->mailer->sent as $email ) {
			$this->assertStringNotContainsString( '@example.com', $email[2] );
		}
	}

	/** An organizer without valid addresses gets its report at the fallback, and the run says so. */
	public function test_organizer_without_addresses_uses_the_fallback() {
		$run = $this->process( self::BETA );

		$this->assertSame( array( 'fallback@example.com' ), array_column( $this->mailer->sent, 0 ) );
		$this->assertTrue( $run['fallback'] );
		$this->assertTrue( SalesSummaryDispatcher::runs( self::BETA )[0]['fallback'] );
		$this->assertSame( 'Fallback address', $this->history->deliveries[1]['recipient_name'] );
	}

	/** The central report holds every organizer and goes to the default organizer. */
	public function test_central_report_consolidates_every_organizer() {
		$this->process( SalesSummarySettings::CENTRAL );

		$this->assertSame( array( 'site@example.com' ), array_column( $this->mailer->sent, 0 ) );
		$html = $this->mailer->sent[0][2];
		foreach ( array( 'Alpha', 'Beta', 'Site', 'Alpha concert', 'Beta workshop', 'Site meetup' ) as $text ) {
			$this->assertStringContainsString( $text, $html );
		}
		$this->assertLessThan( strpos( $html, 'Beta workshop' ), strpos( $html, 'Alpha concert' ) );
		$this->assertStringContainsString( 'all organizers', $this->mailer->sent[0][1] );
	}

	/** Overlapping or repeated cron runs send to each address once. */
	public function test_repeated_run_sends_nothing_more() {
		$this->process( self::ALPHA );
		$this->assertNull( $this->process( self::ALPHA ) );
		$this->assertCount( 2, $this->mailer->sent );
		$this->assertCount( 1, $this->history->executions );
	}

	/** Daily and weekly sends of one report claim separately, and both send. */
	public function test_daily_and_weekly_sends_do_not_collide() {
		$this->process( self::ALPHA, 'daily', '2026-11-18', '2026-11-18 08:00' );
		$this->process( self::ALPHA, 'weekly', '2026-W47', '2026-11-18 08:00' );

		$this->assertCount( 4, $this->mailer->sent );
		$this->assertCount( 2, $this->history->executions );
		$this->assertArrayHasKey( self::ALPHA . '|2026-11-17|sales_daily|' . SalesSummaryDispatcher::destination( 'a1@example.com' ) . '|1', $this->log->rows );
		$this->assertArrayHasKey( self::ALPHA . '|2026-11-09|sales_weekly|' . SalesSummaryDispatcher::destination( 'a1@example.com' ) . '|1', $this->log->rows );
	}

	/** A failed or throwing address doesn't stop the others; neither is retried. */
	public function test_partial_failure_continues_and_is_not_retried() {
		$this->mailer->explode = array( 'a1@example.com' );

		$run = $this->process( self::ALPHA );

		$this->assertSame( 'partial', $run['status'] );
		$this->assertSame( 1, $run['sent'] );
		$this->assertSame( 1, $run['uncertain'] );
		$this->assertSame( array( 'a2@example.com' ), array_column( $this->mailer->sent, 0 ) );
		$outcomes = array_column( $this->history->deliveries, 'outcome' );
		$this->assertSame( array( HistoryOutcome::UNKNOWN, HistoryOutcome::ACCEPTED ), $outcomes );

		$this->mailer->explode = array();
		$this->assertNull( $this->process( self::ALPHA ) );
		$this->assertCount( 1, $this->mailer->sent );
	}

	/** A refused address is recorded as failed. */
	public function test_refused_address_fails() {
		$this->mailer->refuse = array( 'a1@example.com', 'a2@example.com' );

		$this->assertSame( 'failed', $this->process( self::ALPHA )['status'] );
	}

	/** A send that ran after its day passed is dropped, not replayed. */
	public function test_expired_send_is_not_replayed() {
		$run = $this->process( self::ALPHA, 'daily', '2026-11-18', '2026-11-19 08:00' );

		$this->assertSame( 'expired', $run['status'] );
		$this->assertSame( array(), $this->mailer->sent );
		$this->assertSame( array(), $this->log->rows );
	}

	/** A send queued before the report was turned off or changed cadence does nothing. */
	public function test_turned_off_or_changed_report_does_nothing() {
		$off = SalesSummarySettings::sanitize( array( 'frequency' => 'off' ) );
		$this->assertNull( $this->process( self::ALPHA, 'daily', '2026-11-18', '2026-11-18 08:00', $off ) );
		$this->assertNull( $this->process( self::ALPHA, 'daily', '2026-11-18', '2026-11-18 08:00', self::settings( 'weekly' ) ) );
		$this->assertSame( array(), $this->mailer->sent );
	}

	/** Without organizer resolution, additional and central reports pause and sales never move to the default. */
	public function test_disabled_organizer_management_pauses_and_never_regroups() {
		$this->organizers->organizers = null;

		$this->assertSame( 'paused', $this->process( self::ALPHA )['status'] );
		$this->assertSame( 'paused', $this->process( SalesSummarySettings::CENTRAL )['status'] );
		$this->assertSame( array(), $this->mailer->sent );

		$this->process( SalesSummarySettings::DEFAULT_ORGANIZER );
		$this->assertSame( array( 'site@example.com' ), array_column( $this->mailer->sent, 0 ) );
		$html = $this->mailer->sent[0][2];
		$this->assertStringContainsString( 'Site meetup', $html );
		$this->assertStringNotContainsString( 'Alpha concert', $html );
		$this->assertStringNotContainsString( 'Beta workshop', $html );
	}

	/** A period without sales still sends, saying so. */
	public function test_empty_period_sends_no_sales_message() {
		$this->statistics->events = array();

		$this->process( self::ALPHA );

		$this->assertCount( 2, $this->mailer->sent );
		$this->assertStringContainsString( 'No sales in this period.', $this->mailer->sent[0][2] );
	}

	/** Unavailable revenue is never shown as zero. */
	public function test_unavailable_revenue_is_not_zero() {
		$this->statistics->events = array( FakeSalesStatistics::event( 10, 'Alpha concert', 4, 0.0, 'unavailable' ) );

		$this->process( self::ALPHA );

		$html = $this->mailer->sent[0][2];
		$this->assertStringContainsString( 'Not available', $html );
		$this->assertStringNotContainsString( '0.00 EUR', $html );
		$this->assertStringContainsString( 'payment information can’t be read', $html );
	}

	/** The daily report asks for the previous site-local day. */
	public function test_requests_the_previous_day() {
		$this->process( self::ALPHA );

		$this->assertSame( array( '2026-11-17 00:00:00', '2026-11-18 00:00:00' ), $this->statistics->requests[0] );
	}

	/** Recipients are de-duplicated without regard to case; the fallback applies only without any. */
	public function test_recipients() {
		$report = array( 'organizer' => array( 'notification_emails' => array( 'X@example.com', 'x@EXAMPLE.com', 'not an address' ) ) );
		$this->assertSame(
			array(
				'recipients' => array( 'X@example.com' ),
				'fallback'   => false,
			),
			SalesSummaryReport::recipients( $report, self::settings() )
		);

		$report = array( 'organizer' => array( 'notification_emails' => array( 'not an address' ) ) );
		$this->assertSame(
			array(
				'recipients' => array( 'fallback@example.com' ),
				'fallback'   => true,
			),
			SalesSummaryReport::recipients( $report, self::settings() )
		);
	}
}
