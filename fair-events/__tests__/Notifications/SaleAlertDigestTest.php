<?php
/**
 * Ticket sale alert digest unit tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\SaleAlertDispatcher;
use FairEvents\Notifications\SaleAlertLog;
use FairEvents\Notifications\SaleAlertSettings;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fakes/FakeSalesOrganizers.php';
require_once __DIR__ . '/fakes/FakeSaleAlertLog.php';
require_once __DIR__ . '/fakes/FakeSaleAlertSource.php';
require_once __DIR__ . '/fakes/FakeSaleAlertTelegram.php';

/**
 * Tests daily and weekly ticket sale digests (#2449): scheduling in the
 * site timezone, organizer isolation, retries, duplicate prevention and
 * frequency changes.
 */
class SaleAlertDigestTest extends TestCase {
	private const STUDIO = '0f5e6a3c-1d2b-4c3d-8e9f-0a1b2c3d4e5f';
	private const DANCE  = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

	/**
	 * Alert records.
	 *
	 * @var FakeSaleAlertLog
	 */
	private $log;

	/**
	 * Sales.
	 *
	 * @var FakeSaleAlertSource
	 */
	private $source;

	/**
	 * Organizers.
	 *
	 * @var FakeSalesOrganizers
	 */
	private $organizers;

	/**
	 * Telegram.
	 *
	 * @var FakeSaleAlertTelegram
	 */
	private $telegram;

	/**
	 * The sitewide organizer sends immediately, Studio a daily digest at
	 * 08:00 and Dance a weekly digest on Fridays at 18:30, in Madrid time.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']  = array();
		$GLOBALS['_fair_test_cron']     = array();
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		$this->log        = new FakeSaleAlertLog();
		$this->source     = new FakeSaleAlertSource();
		$this->organizers = new FakeSalesOrganizers(
			array(
				array(
					'id'                  => 'default',
					'name'                => 'Site',
					'notification_emails' => array(),
				),
				array(
					'id'                  => self::STUDIO,
					'name'                => 'Studio',
					'notification_emails' => array(),
				),
				array(
					'id'                  => self::DANCE,
					'name'                => 'Dance',
					'notification_emails' => array(),
				),
			),
			array()
		);
		$this->telegram   = new FakeSaleAlertTelegram();

		$this->source->assignments = array(
			20 => self::STUDIO,
			21 => self::STUDIO,
			30 => self::DANCE,
		);

		$this->configure( self::STUDIO, 'daily' );
		$this->configure( self::DANCE, 'weekly' );
	}

	/**
	 * Clear the site timezone.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );
	}

	/**
	 * Save the three organizers, with one organizer's frequency changed.
	 *
	 * @param string $organizer Organizer to change.
	 * @param string $frequency Its frequency.
	 * @param array  $overrides Other fields of that organizer.
	 * @return void
	 */
	private function configure( $organizer, $frequency, array $overrides = array() ) {
		$current                  = SaleAlertSettings::get()['organizers'];
		$base                     = array(
			'default'    => array(
				'enabled' => true,
				'chat_id' => '-100001',
			),
			self::STUDIO => array(
				'enabled'     => true,
				'chat_id'     => '-100002',
				'frequency'   => 'immediate',
				'time_of_day' => '08:00',
			),
			self::DANCE  => array(
				'enabled'     => true,
				'chat_id'     => '@dance_sales',
				'frequency'   => 'immediate',
				'time_of_day' => '18:30',
				'day_of_week' => 5,
			),
		);
		$organizers               = array_merge( $base, $current );
		$organizers[ $organizer ] = array_merge( $organizers[ $organizer ], array( 'frequency' => $frequency ), $overrides );
		SaleAlertSettings::save(
			array(
				'enabled'    => true,
				'organizers' => $organizers,
			)
		);
	}

	/**
	 * Dispatcher with the fakes.
	 *
	 * @return SaleAlertDispatcher
	 */
	private function dispatcher() {
		return new SaleAlertDispatcher( $this->log, $this->source, $this->organizers, $this->telegram );
	}

	/**
	 * Add, confirm and process a paid sale of one purchase.
	 *
	 * @param int    $transaction_id Transaction ID.
	 * @param int    $event_id       Owning event, also the purchased date.
	 * @param float  $amount         Amount charged.
	 * @param string $ticket         Ticket type name.
	 * @return string State after processing.
	 */
	private function sell( $transaction_id, $event_id, $amount = 30.0, $ticket = 'Adult' ) {
		$this->source->owners[ $event_id ]      = $event_id;
		$this->source->sales[ $transaction_id ] = array(
			'transaction' => array(
				'id'       => $transaction_id,
				'status'   => 'paid',
				'amount'   => $amount,
				'currency' => 'EUR',
				'source'   => 'fair-events-get-tickets',
			),
			'purchases'   => array(
				array(
					'id'             => $transaction_id * 10,
					'status'         => 'confirmed',
					'transaction_id' => $transaction_id,
					'event_date_id'  => $event_id,
					'owner_id'       => $event_id,
				),
			),
			'tickets'     => array(
				array(
					'ticket_type_id' => 1,
					'name'           => $ticket,
					'quantity'       => 2,
				),
			),
			'dates'       => array( 'Friday ' . $event_id ),
			'owner_ids'   => array( $event_id ),
			'event'       => array(
				'id'           => $event_id,
				'title'        => 'Event ' . $event_id,
				'organizer_id' => $this->source->assignments[ $event_id ] ?? null,
			),
		);

		$this->dispatcher()->queue(
			(object) array( 'event_date_id' => $event_id ),
			(object) array(
				'id'       => $transaction_id,
				'status'   => 'paid',
				'amount'   => $amount,
				'metadata' => '{"source":"fair-events-get-tickets"}',
			)
		);
		return $this->dispatcher()->process( $transaction_id );
	}

	/**
	 * Queued digests of an organizer.
	 *
	 * @param string $organizer Organizer key.
	 * @return array[] Each `array( timestamp, args )`.
	 */
	private function digests( $organizer ) {
		$events = array();
		foreach ( $GLOBALS['_fair_test_cron'][ SaleAlertDispatcher::DIGEST_HOOK ] ?? array() as $event ) {
			if ( $event[1][0] === $organizer ) {
				$events[] = $event;
			}
		}
		return $events;
	}

	/**
	 * A moment in the site timezone.
	 *
	 * @param int $timestamp Unix time.
	 * @return \DateTimeImmutable
	 */
	private static function local( $timestamp ) {
		return ( new \DateTimeImmutable( '@' . $timestamp ) )->setTimezone( new \DateTimeZone( 'Europe/Madrid' ) );
	}

	/**
	 * Immediate organizers keep one message per sale; digest organizers'
	 * sales wait, with the next digest scheduled at the site-local time.
	 *
	 * @return void
	 */
	public function test_digest_sales_wait_for_the_scheduled_time() {
		$this->assertSame( SaleAlertLog::SENT, $this->sell( 1, 10 ) );
		$this->assertSame( SaleAlertLog::PENDING, $this->sell( 2, 20 ) );
		$this->assertSame( SaleAlertLog::PENDING, $this->sell( 3, 30 ) );

		$this->assertSame( array( '-100001' ), array_column( $this->telegram->sent, 'chat_id' ) );

		$daily = $this->digests( self::STUDIO );
		$this->assertCount( 1, $daily );
		$due = self::local( $daily[0][0] );
		$this->assertSame( '08:00', $due->format( 'H:i' ) );
		$this->assertGreaterThan( time(), $daily[0][0] );
		$this->assertLessThanOrEqual( time() + DAY_IN_SECONDS + HOUR_IN_SECONDS, $daily[0][0] );
		$this->assertSame( array( self::STUDIO, 'daily', $due->format( 'Y-m-d' ) ), $daily[0][1] );

		$weekly = $this->digests( self::DANCE );
		$this->assertCount( 1, $weekly );
		$due = self::local( $weekly[0][0] );
		$this->assertSame( array( '5', '18:30' ), array( $due->format( 'N' ), $due->format( 'H:i' ) ) );
		$this->assertLessThanOrEqual( time() + 7 * DAY_IN_SECONDS + HOUR_IN_SECONDS, $weekly[0][0] );
		$this->assertSame( $weekly[0][0], SaleAlertDispatcher::next_digest( self::DANCE ) );
		$this->assertNull( SaleAlertDispatcher::next_digest( 'default' ) );
	}

	/**
	 * A digest combines only its organizer's sales, once, and sends
	 * nothing when no sale is pending.
	 *
	 * @return void
	 */
	public function test_digest_combines_only_its_organizers_sales() {
		$this->sell( 1, 20, 30.0, 'Adult' );
		$this->sell( 2, 21, 12.5, 'Child' );
		$this->sell( 3, 20, 30.0, 'Adult' );
		$this->sell( 4, 30 );

		$this->assertSame( SaleAlertLog::SENT, $this->dispatcher()->send_digest( self::STUDIO ) );

		$this->assertCount( 1, $this->telegram->sent );
		$this->assertSame( '-100002', $this->telegram->sent[0]['chat_id'] );
		$html = $this->telegram->sent[0]['html'];
		$this->assertStringContainsString( '<b>Ticket sales digest</b>', $html );
		$this->assertStringContainsString( '3 sales, total: 72.50 EUR', $html );
		$this->assertStringContainsString( "<b>Event 20</b>\nFriday 20\n4 × Adult\n2 sales: 60.00 EUR", $html );
		$this->assertStringContainsString( "<b>Event 21</b>\nFriday 21\n2 × Child\n1 sale: 12.50 EUR", $html );
		$this->assertStringNotContainsString( 'Event 30', $html );

		foreach ( array( 1, 2, 3 ) as $transaction_id ) {
			$this->assertSame( SaleAlertLog::SENT, $this->log->get( $transaction_id )['state'] );
		}
		$this->assertSame( SaleAlertLog::PENDING, $this->log->get( 4 )['state'] );

		// Nothing left: no empty digest, and the sales are never sent twice.
		$this->assertSame( '', $this->dispatcher()->send_digest( self::STUDIO ) );
		$this->assertCount( 1, $this->telegram->sent );
	}

	/**
	 * A competing digest run while one is sending claims nothing.
	 *
	 * @return void
	 */
	public function test_competing_digest_runs_send_once() {
		$this->sell( 1, 20 );
		$this->telegram->during_send = function () {
			$this->assertSame( '', $this->dispatcher()->send_digest( self::STUDIO ) );
		};

		$this->assertSame( SaleAlertLog::SENT, $this->dispatcher()->send_digest( self::STUDIO ) );
		$this->assertCount( 1, $this->telegram->sent );
	}

	/**
	 * A refused digest keeps its sales for the next one; one Telegram may
	 * have accepted is never resent.
	 *
	 * @return void
	 */
	public function test_refused_digest_retries_and_uncertain_does_not() {
		$this->sell( 1, 20 );
		$this->telegram->result = array(
			'state'   => 'failed',
			'code'    => 'http_400',
			'message' => '',
		);

		$this->assertSame( SaleAlertLog::PENDING, $this->dispatcher()->send_digest( self::STUDIO ) );
		$this->assertSame( SaleAlertLog::PENDING, $this->log->get( 1 )['state'] );
		$this->assertSame( 'http_400', $this->log->get( 1 )['reason'] );

		$this->telegram->result = array(
			'state'   => 'uncertain',
			'code'    => 'timeout',
			'message' => '',
		);
		$this->assertSame( SaleAlertLog::UNCERTAIN, $this->dispatcher()->send_digest( self::STUDIO ) );
		$this->assertSame( SaleAlertLog::UNCERTAIN, $this->log->get( 1 )['state'] );

		$this->assertSame( '', $this->dispatcher()->send_digest( self::STUDIO ) );
		$this->assertCount( 2, $this->telegram->sent );
	}

	/**
	 * While alerts are off, for the organizer or sitewide, or the bot
	 * token has a problem, pending sales are kept, not dropped.
	 *
	 * @return void
	 */
	public function test_pending_sales_are_kept_while_sending_is_impossible() {
		$this->sell( 1, 20 );

		$this->telegram->problem = array( 'code' => 'missing_token' );
		$this->assertSame( '', $this->dispatcher()->send_digest( self::STUDIO ) );
		$this->telegram->problem = null;

		$this->configure( self::STUDIO, 'daily', array( 'enabled' => false ) );
		$this->assertSame( '', $this->dispatcher()->send_digest( self::STUDIO ) );

		$this->assertSame( SaleAlertLog::PENDING, $this->log->get( 1 )['state'] );
		$this->assertSame( array(), $this->telegram->sent );

		$this->configure( self::STUDIO, 'daily', array( 'enabled' => true ) );
		$this->assertSame( SaleAlertLog::SENT, $this->dispatcher()->send_digest( self::STUDIO ) );
	}

	/**
	 * A sale whose event moved to another organizer while pending is left
	 * out of the digest, never sent to either.
	 *
	 * @return void
	 */
	public function test_sale_moved_to_another_organizer_is_skipped() {
		$this->sell( 1, 20 );
		$this->sell( 2, 21 );
		$this->source->assignments[20] = self::DANCE;

		$this->dispatcher()->send_digest( self::STUDIO );

		$this->assertSame( SaleAlertLog::SKIPPED, $this->log->get( 1 )['state'] );
		$this->assertSame( SaleAlertDispatcher::REASON_ASSIGNMENT_CHANGED, $this->log->get( 1 )['reason'] );
		$this->assertStringNotContainsString( 'Event 20', $this->telegram->sent[0]['html'] );
		$this->assertStringContainsString( 'Event 21', $this->telegram->sent[0]['html'] );
		$this->assertSame( array( '-100002' ), array_column( $this->telegram->sent, 'chat_id' ) );
		$this->assertSame( '', $this->dispatcher()->send_digest( self::DANCE ) );
	}

	/**
	 * Changing Daily to Weekly moves the next digest and carries the
	 * pending sales into it.
	 *
	 * @return void
	 */
	public function test_cadence_change_moves_the_next_digest_and_keeps_pending() {
		$this->sell( 1, 20 );
		$this->assertSame( 'daily', $this->digests( self::STUDIO )[0][1][1] );

		$this->configure(
			self::STUDIO,
			'weekly',
			array(
				'day_of_week' => 3,
				'time_of_day' => '09:15',
			)
		);
		SaleAlertDispatcher::reschedule_digest( self::STUDIO, $this->log );

		$digests = $this->digests( self::STUDIO );
		$this->assertCount( 1, $digests );
		$this->assertSame( 'weekly', $digests[0][1][1] );
		$due = self::local( $digests[0][0] );
		$this->assertSame( array( '3', '09:15' ), array( $due->format( 'N' ), $due->format( 'H:i' ) ) );
		$this->assertSame( SaleAlertLog::PENDING, $this->log->get( 1 )['state'] );

		// Saving unchanged settings keeps the queued digest.
		SaleAlertDispatcher::reschedule_digest( self::STUDIO, $this->log );
		$this->assertSame( $digests, $this->digests( self::STUDIO ) );
	}

	/**
	 * Switching to Immediate sends what is pending as one final digest and
	 * later sales one by one.
	 *
	 * @return void
	 */
	public function test_switch_to_immediate_sends_a_final_digest() {
		$this->sell( 1, 20 );
		$this->sell( 2, 21 );

		$this->configure( self::STUDIO, 'immediate' );
		SaleAlertDispatcher::reschedule_digest( self::STUDIO, $this->log );

		$digests = $this->digests( self::STUDIO );
		$this->assertCount( 1, $digests );
		$this->assertSame( array( self::STUDIO, 'immediate', SaleAlertDispatcher::FLUSH ), $digests[0][1] );

		$this->assertSame( SaleAlertLog::SENT, $this->dispatcher()->send_digest( self::STUDIO ) );
		$this->assertCount( 1, $this->telegram->sent );
		$this->assertStringContainsString( '2 sales, total: 60.00 EUR', $this->telegram->sent[0]['html'] );

		$this->assertSame( SaleAlertLog::SENT, $this->sell( 3, 20 ) );
		$this->assertCount( 2, $this->telegram->sent );
		$this->assertStringContainsString( 'New ticket sale', $this->telegram->sent[1]['html'] );
	}

	/**
	 * No final digest is queued when nothing is pending.
	 *
	 * @return void
	 */
	public function test_switch_to_immediate_without_pending_queues_nothing() {
		$this->configure( self::STUDIO, 'immediate' );
		SaleAlertDispatcher::reschedule_digest( self::STUDIO, $this->log );

		$this->assertSame( array(), $this->digests( self::STUDIO ) );
	}

	/**
	 * Recovery sends sales left pending for an organizer that now sends
	 * immediately, and restores a lost digest schedule.
	 *
	 * @return void
	 */
	public function test_recovery_flushes_leftovers_and_restores_the_schedule() {
		$this->sell( 1, 20 );
		$this->configure( self::STUDIO, 'immediate' );
		$GLOBALS['_fair_test_cron'] = array();

		$this->dispatcher()->recover();

		$this->assertSame( SaleAlertLog::SENT, $this->log->get( 1 )['state'] );
		$this->assertCount( 1, $this->telegram->sent );
		$this->assertCount( 1, $this->digests( self::DANCE ) );
	}

	/**
	 * A digest queued with a cadence the organizer no longer has sends
	 * nothing.
	 *
	 * @return void
	 */
	public function test_stale_digest_event_sends_nothing() {
		$this->sell( 1, 20 );
		$this->configure( self::STUDIO, 'weekly' );

		SaleAlertDispatcher::handle_digest( self::STUDIO, 'daily', '2026-11-24' );

		$this->assertSame( SaleAlertLog::PENDING, $this->log->get( 1 )['state'] );
		$this->assertSame( array(), $this->telegram->sent );
	}
}
