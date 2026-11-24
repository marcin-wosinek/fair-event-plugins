<?php
/**
 * SaleAlertDispatcher unit tests.
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
 * Tests routing, purchase triggers, duplicate prevention and delivery
 * outcomes of ticket sale alerts (#2448).
 */
class SaleAlertDispatcherTest extends TestCase {
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
	 * Three organizers with their own destinations; alerts on.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']        = array();
		$GLOBALS['_fair_test_scheduled']      = array();
		$GLOBALS['_fair_test_cron_scheduled'] = array();

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

		SaleAlertSettings::save(
			array(
				'enabled'    => true,
				'organizers' => array(
					'default'    => array(
						'enabled' => true,
						'chat_id' => '-100001',
					),
					self::STUDIO => array(
						'enabled' => true,
						'chat_id' => '-100002',
					),
					self::DANCE  => array(
						'enabled' => true,
						'chat_id' => '@dance_sales',
					),
				),
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
	 * Add a paid sale: purchases on dates of one event.
	 *
	 * @param int        $transaction_id Transaction ID.
	 * @param int        $event_id       Owning event.
	 * @param array      $date_ids       Purchased dates, one purchase each.
	 * @param array|null $transaction    Transaction overrides.
	 * @return void
	 */
	private function sale( $transaction_id, $event_id, array $date_ids, $transaction = null ) {
		$purchases = array();
		foreach ( $date_ids as $index => $date_id ) {
			$this->source->owners[ $date_id ] = $event_id;
			$purchases[]                      = array(
				'id'             => $transaction_id * 10 + $index,
				'status'         => 'confirmed',
				'transaction_id' => $transaction_id,
				'event_date_id'  => $date_id,
				'owner_id'       => $event_id,
			);
		}
		$this->source->sales[ $transaction_id ] = array(
			'transaction' => array_merge(
				array(
					'id'       => $transaction_id,
					'status'   => 'paid',
					'amount'   => 30.0,
					'currency' => 'EUR',
					'source'   => 'fair-events-get-tickets',
				),
				(array) $transaction
			),
			'purchases'   => $purchases,
			'tickets'     => array(
				array(
					'ticket_type_id' => 1,
					'name'           => 'Adult',
					'quantity'       => count( $date_ids ),
				),
			),
			'dates'       => array( 'Friday' ),
			'owner_ids'   => array( $event_id ),
			'event'       => array(
				'id'           => $event_id,
				'title'        => 'Event ' . $event_id,
				'organizer_id' => null,
			),
		);
	}

	/**
	 * The confirmation callback for one purchase of a sale.
	 *
	 * @param int   $transaction_id Transaction ID.
	 * @param int   $date_id        Purchased date.
	 * @param array $transaction    Transaction field overrides.
	 * @return bool
	 */
	private function confirm( $transaction_id, $date_id, array $transaction = array() ) {
		$signup      = (object) array( 'event_date_id' => $date_id );
		$transaction = (object) array_merge(
			array(
				'id'       => $transaction_id,
				'status'   => 'paid',
				'amount'   => 30.0,
				'metadata' => '{"source":"fair-events-get-tickets"}',
			),
			$transaction
		);
		return $this->dispatcher()->queue( $signup, $transaction );
	}

	/**
	 * Events without an assignment go to the sitewide destination, assigned
	 * events (and generated occurrences of an assigned series) only to
	 * their organizer's.
	 *
	 * @return void
	 */
	public function test_routes_each_sale_to_its_organizer() {
		$this->source->assignments = array(
			20 => self::STUDIO,
			30 => self::DANCE,
		);
		$this->sale( 1, 10, array( 10 ) );
		$this->sale( 2, 20, array( 20 ) );
		$this->sale( 3, 30, array( 31, 32 ) );

		$this->confirm( 1, 10 );
		$this->confirm( 2, 20 );
		$this->confirm( 3, 31 );
		$this->confirm( 3, 32 );
		foreach ( array( 1, 2, 3 ) as $transaction_id ) {
			$this->assertSame( SaleAlertLog::SENT, $this->dispatcher()->process( $transaction_id ) );
		}

		$this->assertSame( array( '-100001', '-100002', '@dance_sales' ), array_column( $this->telegram->sent, 'chat_id' ) );
		$this->assertStringContainsString( '<b>Event 30</b>', $this->telegram->sent[2]['html'] );
		$this->assertStringContainsString( '2 × Adult', $this->telegram->sent[2]['html'] );
		$this->assertStringContainsString( 'Total: 30.00 EUR', $this->telegram->sent[2]['html'] );
	}

	/**
	 * Nothing is queued while alerts are off, so a site that never turned
	 * them on sends nothing.
	 *
	 * @return void
	 */
	public function test_nothing_is_queued_while_off() {
		SaleAlertSettings::save(
			array(
				'enabled'    => false,
				'organizers' => array(),
			)
		);
		$this->sale( 1, 10, array( 10 ) );

		$this->assertFalse( $this->confirm( 1, 10 ) );
		$this->assertSame( array(), $this->log->rows );
	}

	/**
	 * Pending, failed, cancelled, free and other sources' payments queue
	 * no alert.
	 *
	 * @return void
	 */
	public function test_only_paid_get_tickets_charges_queue_an_alert() {
		$this->sale( 1, 10, array( 10 ) );

		foreach ( array( 'pending', 'failed', 'canceled', 'expired' ) as $status ) {
			$this->assertFalse( $this->confirm( 1, 10, array( 'status' => $status ) ) );
		}
		$this->assertFalse( $this->confirm( 1, 10, array( 'amount' => 0 ) ) );
		$this->assertFalse( $this->confirm( 1, 10, array( 'metadata' => '{"source":"fair-audience"}' ) ) );
		$this->assertSame( array(), $this->log->rows );
	}

	/**
	 * A replayed webhook or confirmation, and a competing worker, send
	 * nothing twice.
	 *
	 * @return void
	 */
	public function test_replays_and_competing_workers_send_once() {
		$this->sale( 1, 10, array( 10 ) );
		$this->confirm( 1, 10 );

		$competing                   = null;
		$this->telegram->during_send = function () use ( &$competing ) {
			$competing = $this->dispatcher()->process( 1 );
		};
		$this->assertSame( SaleAlertLog::SENT, $this->dispatcher()->process( 1 ) );
		$this->assertSame( '', $competing );

		$this->telegram->during_send = null;
		$this->assertFalse( $this->confirm( 1, 10 ) );
		$this->assertSame( '', $this->dispatcher()->process( 1 ) );
		$this->dispatcher()->recover();

		$this->assertCount( 1, $this->telegram->sent );
	}

	/**
	 * A series is alerted once every purchase the payment covers is
	 * confirmed, describing all of them.
	 *
	 * @return void
	 */
	public function test_waits_for_every_linked_purchase() {
		$this->sale( 1, 30, array( 31, 32 ) );
		$this->source->sales[1]['purchases'][1]['status'] = 'pending_payment';

		$this->confirm( 1, 31 );
		$this->assertSame( SaleAlertLog::QUEUED, $this->dispatcher()->process( 1 ) );
		$this->assertSame( array(), $this->telegram->sent );

		$this->source->sales[1]['purchases'][1]['status'] = 'confirmed';
		$this->confirm( 1, 32 );
		$this->assertSame( SaleAlertLog::SENT, $this->dispatcher()->process( 1 ) );
		$this->assertCount( 1, $this->telegram->sent );
	}

	/**
	 * A purchase that stays unconfirmed past the wait is skipped, not sent
	 * with a total that doesn't match.
	 *
	 * @return void
	 */
	public function test_skips_purchases_never_confirmed() {
		$this->sale( 1, 30, array( 31, 32 ) );
		$this->source->sales[1]['purchases'][1]['status'] = 'pending_payment';
		$this->confirm( 1, 31 );
		$this->log->age( 1, SaleAlertDispatcher::CONFIRMATION_WAIT + 1 );

		$this->assertSame( SaleAlertLog::SKIPPED, $this->dispatcher()->process( 1 ) );
		$this->assertSame( SaleAlertDispatcher::REASON_INCOMPLETE, $this->log->rows[1]['reason'] );
	}

	/**
	 * Purchases of another attempt, a failed purchase, or of more than one
	 * event make the attribution inconsistent.
	 *
	 * @return void
	 */
	public function test_skips_inconsistent_attribution() {
		$this->sale( 1, 10, array( 10 ) );
		$this->source->sales[1]['purchases'][0]['transaction_id'] = 99;
		$this->sale( 2, 10, array( 10 ) );
		$this->source->sales[2]['purchases'][0]['status'] = 'failed';
		$this->sale( 3, 10, array( 10 ) );
		$this->source->sales[3]['owner_ids'] = array( 10, 20 );

		foreach ( array( 1, 2, 3 ) as $transaction_id ) {
			$this->confirm( $transaction_id, 10 );
			$this->assertSame( SaleAlertLog::SKIPPED, $this->dispatcher()->process( $transaction_id ) );
			$this->assertSame( SaleAlertDispatcher::REASON_INCONSISTENT, $this->log->rows[ $transaction_id ]['reason'] );
		}
		$this->assertSame( array(), $this->telegram->sent );
	}

	/**
	 * An assigned organizer that can't be resolved is skipped with a
	 * warning, never forwarded to the sitewide destination.
	 *
	 * @return void
	 */
	public function test_unavailable_organizer_is_never_forwarded() {
		$this->source->assignments = array( 20 => self::STUDIO );
		$this->sale( 1, 20, array( 20 ) );
		$this->sale( 2, 10, array( 10 ) );
		$this->organizers->organizers = null;

		$this->confirm( 1, 20 );
		$this->confirm( 2, 10 );

		$this->assertSame( SaleAlertLog::SKIPPED, $this->dispatcher()->process( 1 ) );
		$this->assertSame( SaleAlertDispatcher::REASON_ORGANIZER_UNAVAILABLE, $this->log->rows[1]['reason'] );
		$this->assertSame( SaleAlertLog::SENT, $this->dispatcher()->process( 2 ) );
		$this->assertSame( array( '-100001' ), array_column( $this->telegram->sent, 'chat_id' ) );
	}

	/**
	 * While an alert is queued: organizer management turned off, the
	 * destination removed, the organizer switched off, or the event given
	 * to another organizer each skip it.
	 *
	 * @return void
	 */
	public function test_rechecks_before_sending() {
		$this->source->assignments = array(
			20 => self::STUDIO,
			30 => self::DANCE,
			40 => self::STUDIO,
		);
		foreach ( array( 10, 20, 30, 40 ) as $event_id ) {
			$this->sale( $event_id, $event_id, array( $event_id ) );
			$this->confirm( $event_id, $event_id );
		}

		// Event 40 is given to Dance; Dance is switched off; the sitewide
		// destination is removed; then organizer management goes off.
		$this->source->assignments[40] = self::DANCE;
		$this->assertSame( SaleAlertLog::SKIPPED, $this->dispatcher()->process( 40 ) );
		$this->assertSame( SaleAlertDispatcher::REASON_ASSIGNMENT_CHANGED, $this->log->rows[40]['reason'] );

		SaleAlertSettings::save(
			array(
				'enabled'    => true,
				'organizers' => array(
					self::DANCE => array(
						'enabled' => false,
						'chat_id' => '@dance_sales',
					),
					'default'   => array(
						'enabled' => false,
						'chat_id' => '',
					),
				),
			)
		);
		$this->assertSame( SaleAlertLog::SKIPPED, $this->dispatcher()->process( 30 ) );
		$this->assertSame( SaleAlertDispatcher::REASON_ORGANIZER_DISABLED, $this->log->rows[30]['reason'] );
		$this->assertSame( SaleAlertLog::SKIPPED, $this->dispatcher()->process( 10 ) );
		$this->assertSame( SaleAlertDispatcher::REASON_ORGANIZER_DISABLED, $this->log->rows[10]['reason'] );

		$this->organizers->organizers = null;
		$this->assertSame( SaleAlertLog::SKIPPED, $this->dispatcher()->process( 20 ) );
		$this->assertSame( SaleAlertDispatcher::REASON_ORGANIZER_UNAVAILABLE, $this->log->rows[20]['reason'] );

		$this->assertSame( array(), $this->telegram->sent );
	}

	/**
	 * An organizer never set up has no destination: a warning reason.
	 *
	 * @return void
	 */
	public function test_unconfigured_organizer_has_no_destination() {
		$GLOBALS['_fair_test_options'] = array();
		SaleAlertSettings::save(
			array(
				'enabled'    => true,
				'organizers' => array(),
			)
		);
		$this->sale( 1, 10, array( 10 ) );
		$this->confirm( 1, 10 );

		$this->assertSame( SaleAlertLog::SKIPPED, $this->dispatcher()->process( 1 ) );
		$this->assertSame( SaleAlertDispatcher::REASON_MISSING_DESTINATION, $this->log->rows[1]['reason'] );
	}

	/**
	 * Alerts turned off after queueing, and a missing bot token, send
	 * nothing.
	 *
	 * @return void
	 */
	public function test_skips_when_off_or_without_token() {
		$this->sale( 1, 10, array( 10 ) );
		$this->sale( 2, 10, array( 10 ) );
		$this->confirm( 1, 10 );
		$this->confirm( 2, 10 );

		$this->telegram->problem = array(
			'code'    => 'missing_token',
			'message' => 'No token',
		);
		$this->assertSame( SaleAlertLog::SKIPPED, $this->dispatcher()->process( 1 ) );
		$this->assertSame( 'missing_token', $this->log->rows[1]['reason'] );

		SaleAlertSettings::save(
			array(
				'enabled'    => false,
				'organizers' => array(),
			)
		);
		$this->assertSame( SaleAlertLog::SKIPPED, $this->dispatcher()->process( 2 ) );
		$this->assertSame( SaleAlertDispatcher::REASON_DISABLED, $this->log->rows[2]['reason'] );
		$this->assertSame( array(), $this->telegram->sent );
	}

	/**
	 * A rejection is recorded as failed and a timeout as uncertain, with a
	 * safe code only; neither is resent by a replay or the recovery.
	 *
	 * @return void
	 */
	public function test_records_failures_without_resending() {
		$this->sale( 1, 10, array( 10 ) );
		$this->sale( 2, 10, array( 10 ) );
		$this->confirm( 1, 10 );
		$this->confirm( 2, 10 );

		$this->telegram->result = array(
			'state'   => 'failed',
			'code'    => 'http_400',
			'message' => 'Bad Request: chat not found',
		);
		$this->assertSame( SaleAlertLog::FAILED, $this->dispatcher()->process( 1 ) );
		$this->telegram->result = array(
			'state'   => 'uncertain',
			'code'    => 'transport_error',
			'message' => 'cURL error 28',
		);
		$this->assertSame( SaleAlertLog::UNCERTAIN, $this->dispatcher()->process( 2 ) );

		$this->assertSame( 'http_400', $this->log->rows[1]['reason'] );
		$this->assertSame( 'transport_error', $this->log->rows[2]['reason'] );

		$this->confirm( 1, 10 );
		$this->confirm( 2, 10 );
		$this->dispatcher()->recover();
		$this->assertCount( 2, $this->telegram->sent );
	}

	/**
	 * A worker that stopped before the request is finished by the
	 * recovery; one that stopped during it becomes uncertain, not resent.
	 *
	 * @return void
	 */
	public function test_recovers_interrupted_workers() {
		$this->sale( 1, 10, array( 10 ) );
		$this->sale( 2, 10, array( 10 ) );
		$this->confirm( 1, 10 );
		$this->confirm( 2, 10 );
		$this->log->transition( 1, SaleAlertLog::QUEUED, SaleAlertLog::CLAIMED );
		$this->log->transition( 2, SaleAlertLog::QUEUED, SaleAlertLog::SENDING );
		$this->log->age( 1, SaleAlertDispatcher::STALE_AFTER + 1 );
		$this->log->age( 2, SaleAlertDispatcher::STALE_AFTER + 1 );

		$this->dispatcher()->recover();

		$this->assertSame( SaleAlertLog::SENT, $this->log->rows[1]['state'] );
		$this->assertSame( SaleAlertLog::UNCERTAIN, $this->log->rows[2]['state'] );
		$this->assertSame( SaleAlertDispatcher::REASON_INTERRUPTED, $this->log->rows[2]['reason'] );
		$this->assertCount( 1, $this->telegram->sent );
	}

	/**
	 * A failing alert never interrupts the confirmation that queued it.
	 *
	 * @return void
	 */
	public function test_hook_never_throws() {
		$GLOBALS['_fair_test_options'][ SaleAlertSettings::OPTION ] = array(
			'enabled'    => true,
			'organizers' => array(),
		);

		SaleAlertDispatcher::handle_signup_confirmed( (object) array( 'event_date_id' => 1 ), (object) array( 'id' => 1 ) );
		$this->addToAssertionCount( 1 );
	}
}
