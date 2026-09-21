<?php
/**
 * DigestHooks tests
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Tests\Hooks;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnectorExperimental\Hooks\DigestHooks;
use FairPaymentsConnectorExperimental\Services\NotificationQueue;

require_once __DIR__ . '/fixtures-digest-fakes.php';
require_once __DIR__ . '/fixtures-fake-channel.php';

/**
 * Scheduled digest delivery: cron registration, frequency selection, route
 * grouping, and the sent / failed / stale / overlapping outcomes.
 */
class DigestHooksTest extends TestCase {

	/**
	 * Fake queue.
	 *
	 * @var FakeNotificationQueue
	 */
	private $queue;

	/**
	 * Fake channel returned for every channel name.
	 *
	 * @var FakeChannel
	 */
	private $channel;

	/**
	 * Hooks under test.
	 *
	 * @var DigestHooks
	 */
	private $hooks;

	/**
	 * Reset cron state and build the hooks over the fakes.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_cron'] = array();

		$this->queue   = new FakeNotificationQueue();
		$this->channel = new FakeChannel();
		$this->hooks   = new DigestHooks(
			$this->queue,
			function () {
				return $this->channel;
			}
		);
	}

	/**
	 * Hooks and arguments of the scheduled events, as "hook(arg)" strings.
	 *
	 * @return string[]
	 */
	private function scheduled(): array {
		return array_map(
			function ( $event ) {
				return $event['hook'] . '(' . implode( ',', $event['args'] ) . ')';
			},
			$GLOBALS['_fair_test_cron']
		);
	}

	/**
	 * Each frequency gets its own recurring event on its own schedule.
	 */
	public function test_registers_an_independent_event_per_frequency() {
		$this->hooks->schedule_events();

		$this->assertSame(
			array(
				'fair_payment_flush_digest(hourly)',
				'fair_payment_flush_digest(daily)',
				'fair_payment_flush_digest(weekly)',
			),
			$this->scheduled()
		);
		$this->assertSame(
			array( 'fair_payment_digest_hourly', 'fair_payment_digest_daily', 'fair_payment_digest_weekly' ),
			array_column( $GLOBALS['_fair_test_cron'], 'recurrence' )
		);
	}

	/**
	 * A missing event is repaired without duplicating the ones that exist.
	 */
	public function test_repairs_a_missing_event_without_duplicating_others() {
		$this->hooks->schedule_events();
		$daily_time = wp_next_scheduled( DigestHooks::CRON_HOOK, array( 'daily' ) );

		wp_clear_scheduled_hook( DigestHooks::CRON_HOOK, array( 'weekly' ) );
		$this->hooks->schedule_events();
		$this->hooks->schedule_events();

		$this->assertCount( 3, $GLOBALS['_fair_test_cron'] );
		$this->assertContains( 'fair_payment_flush_digest(weekly)', $this->scheduled() );
		$this->assertSame( $daily_time, wp_next_scheduled( DigestHooks::CRON_HOOK, array( 'daily' ) ) );
	}

	/**
	 * The argument-less hourly event of earlier versions is removed.
	 */
	public function test_removes_the_legacy_argumentless_event() {
		wp_schedule_event( time() + 3600, 'fair_payment_digest_hourly', DigestHooks::CRON_HOOK );

		$this->hooks->schedule_events();

		$this->assertNotContains( 'fair_payment_flush_digest()', $this->scheduled() );
		$this->assertCount( 3, $GLOBALS['_fair_test_cron'] );
	}

	/**
	 * A run only sends rows captured for its own frequency.
	 */
	public function test_sends_only_rows_of_the_requested_frequency() {
		$daily  = $this->queue->add( array( 'frequency' => 'daily' ) );
		$hourly = $this->queue->add( array( 'frequency' => 'hourly' ) );
		$weekly = $this->queue->add( array( 'frequency' => 'weekly' ) );

		$this->hooks->flush_due( 'daily' );

		$this->assertCount( 1, $this->channel->sent );
		$this->assertSame( NotificationQueue::STATUS_SENT, $daily->status );
		$this->assertSame( NotificationQueue::STATUS_PENDING, $hourly->status );
		$this->assertSame( NotificationQueue::STATUS_PENDING, $weekly->status );
	}

	/**
	 * An unknown or missing frequency (the legacy event) sends nothing.
	 */
	public function test_ignores_an_unknown_frequency() {
		$row = $this->queue->add();

		$this->hooks->flush_due();
		$this->hooks->flush_due( 'monthly' );

		$this->assertSame( array(), $this->channel->sent );
		$this->assertSame( NotificationQueue::STATUS_PENDING, $row->status );
	}

	/**
	 * Rows are grouped by route: one digest per route, each with its own count
	 * and per-currency totals, each transaction body exactly once.
	 */
	public function test_sends_one_digest_per_route_group() {
		$this->queue->add(
			array(
				'rendered_text' => 'Sale one',
				'amount'        => '10.00',
			)
		);
		$this->queue->add(
			array(
				'rendered_text' => 'Sale two',
				'amount'        => '5.50',
			)
		);
		$this->queue->add(
			array(
				'rendered_text' => 'Sale three',
				'amount'        => '20.00',
				'currency'      => 'USD',
			)
		);
		$this->queue->add(
			array(
				'route_id'      => 'route-b',
				'destination'   => 'other@example.test',
				'rendered_text' => 'Other route sale',
			)
		);

		$this->hooks->flush_due( 'daily' );

		$this->assertCount( 2, $this->channel->sent );

		list( $destination, $text ) = $this->channel->sent[0];
		$this->assertSame( 'owner@example.test', $destination );
		$this->assertStringContainsString( '3 sales', $text );
		$this->assertStringContainsString( '15.50 EUR', $text );
		$this->assertStringContainsString( '20.00 USD', $text );
		foreach ( array( 'Sale one', 'Sale two', 'Sale three' ) as $body ) {
			$this->assertSame( 1, substr_count( $text, $body ), $body );
		}
		$this->assertStringNotContainsString( 'Other route sale', $text );

		list( $destination, $text ) = $this->channel->sent[1];
		$this->assertSame( 'other@example.test', $destination );
		$this->assertStringContainsString( '1 sale', $text );
		$this->assertStringContainsString( 'Other route sale', $text );
	}

	/**
	 * Delivery uses the channel and destination captured on the row, and a
	 * successful send marks each included row sent exactly once.
	 */
	public function test_success_marks_rows_sent_once_and_uses_captured_delivery() {
		$row_a = $this->queue->add( array( 'destination' => 'captured@example.test' ) );
		$row_b = $this->queue->add( array( 'destination' => 'captured@example.test' ) );

		$this->hooks->flush_due( 'daily' );
		$this->hooks->flush_due( 'daily' );

		$this->assertCount( 1, $this->channel->sent );
		$this->assertSame( 'captured@example.test', $this->channel->sent[0][0] );
		foreach ( array( $row_a, $row_b ) as $row ) {
			$this->assertSame( NotificationQueue::STATUS_SENT, $row->status );
			$this->assertNotNull( $row->sent_at );
			$this->assertSame( 1, $row->attempts );
			$this->assertSame( '', $row->last_error );
		}
	}

	/**
	 * A reported channel failure keeps the rows and records the attempt.
	 */
	public function test_channel_failure_keeps_rows_for_retry() {
		$row                   = $this->queue->add( array( 'rendered_text' => 'Jane Doe jane@example.test' ) );
		$this->channel->result = false;

		$this->hooks->flush_due( 'daily' );

		$this->assertSame( NotificationQueue::STATUS_PENDING, $row->status );
		$this->assertNull( $row->sent_at );
		$this->assertSame( 1, $row->attempts );
		$this->assertSame( 'Channel reported a failed send.', $row->last_error );
		$this->assertSame( 'Jane Doe jane@example.test', $row->rendered_text );

		// The next run retries and, once the channel recovers, delivers.
		$this->channel->result = true;
		$this->hooks->flush_due( 'daily' );

		$this->assertSame( NotificationQueue::STATUS_SENT, $row->status );
		$this->assertSame( 2, $row->attempts );
		$this->assertCount( 2, $this->channel->sent );
	}

	/**
	 * A thrown exception takes the same retry path and its message, which may
	 * carry the recipient or body, is not stored.
	 */
	public function test_exception_is_a_retryable_failure_with_a_sanitized_error() {
		$row                  = $this->queue->add();
		$this->channel->throw = new \RuntimeException( 'SMTP rejected owner@example.test' );

		$this->hooks->flush_due( 'daily' );

		$this->assertSame( NotificationQueue::STATUS_PENDING, $row->status );
		$this->assertSame( 'Send raised RuntimeException.', $row->last_error );
		$this->assertStringNotContainsString( 'example.test', $row->last_error );
	}

	/**
	 * An unknown channel is a retryable failure, not a discard.
	 */
	public function test_unknown_channel_keeps_rows() {
		$row         = $this->queue->add();
		$this->hooks = new DigestHooks(
			$this->queue,
			function () {
				return null;
			}
		);

		$this->hooks->flush_due( 'daily' );

		$this->assertSame( NotificationQueue::STATUS_PENDING, $row->status );
		$this->assertSame( 'Unknown notification channel.', $row->last_error );
	}

	/**
	 * A claim held for longer than the stuck threshold becomes eligible again.
	 */
	public function test_stale_claim_is_reclaimed() {
		$stale = gmdate( 'Y-m-d H:i:s', time() - ( DigestHooks::STUCK_MINUTES + 1 ) * MINUTE_IN_SECONDS );
		$row   = $this->queue->add(
			array(
				'status'      => NotificationQueue::STATUS_SENDING,
				'claim_token' => 'dead-run',
				'claimed_at'  => $stale,
				'attempts'    => 1,
			)
		);

		$this->hooks->flush_due( 'daily' );

		$this->assertCount( 1, $this->channel->sent );
		$this->assertSame( NotificationQueue::STATUS_SENT, $row->status );
		$this->assertSame( 2, $row->attempts );
	}

	/**
	 * A recent claim belongs to a run still in progress and is left alone.
	 */
	public function test_recent_claim_is_not_taken() {
		$row = $this->queue->add(
			array(
				'status'      => NotificationQueue::STATUS_SENDING,
				'claim_token' => 'live-run',
				'claimed_at'  => gmdate( 'Y-m-d H:i:s' ),
			)
		);

		$this->hooks->flush_due( 'daily' );

		$this->assertSame( array(), $this->channel->sent );
		$this->assertSame( 'live-run', $row->claim_token );
	}

	/**
	 * A run that starts while another is mid-send finds the group claimed and
	 * does not send a second copy.
	 */
	public function test_overlapping_run_does_not_send_a_second_digest() {
		$row = $this->queue->add();

		$this->channel->on_send = function () {
			$this->hooks->flush_due( 'daily' );
		};

		$this->hooks->flush_due( 'daily' );

		$this->assertCount( 1, $this->channel->sent );
		$this->assertSame( NotificationQueue::STATUS_SENT, $row->status );
		$this->assertSame( 1, $row->attempts );
	}
}
