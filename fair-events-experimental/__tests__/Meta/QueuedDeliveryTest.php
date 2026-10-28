<?php
/**
 * Queued Meta delivery: claims, interrupted workers, retries and budgets.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\Conversions;
use FairEventsExperimental\Meta\DeliverySchedule;
use FairEventsExperimental\Meta\Outbox;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/OutboxTableFake.php';

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/** Covers claim tokens, leases, attempt accounting and the bounded worker. */
class QueuedDeliveryTest extends TestCase {
	/** Lease end in the stubbed past: `current_time()` is 2026-01-01 00:00:00. */
	private const EXPIRED = '2025-12-31 23:55:00';

	/** @var mixed Original $wpdb. */
	private $original_wpdb;

	/** @var OutboxTableFake */
	private $db;

	/** Install the in-memory outbox, credentials and an accepting Meta. */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_options']              = array(
			Conversions::DATASET_OPTION => '123456',
			Conversions::TOKEN_OPTION   => 'token-value',
		);
		$GLOBALS['_fair_test_remote_post_requests'] = array();
		$GLOBALS['_fair_test_cron']                 = array();
		$GLOBALS['_fair_test_cron_fails']           = false;
		$this->meta_answers( 200, array( 'events_received' => 1 ) );
		$this->original_wpdb = $GLOBALS['wpdb'] ?? null;
		$this->db            = new OutboxTableFake();
		$GLOBALS['wpdb']     = $this->db; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test fake, restored in tearDown().
	}

	/** Restore $wpdb. */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->original_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the original.
		unset( $GLOBALS['_fair_test_remote_post_response'] );
		parent::tearDown();
	}

	/** @param int $status HTTP status. @param array $body Body. */
	private function meta_answers( $status, $body ) {
		$GLOBALS['_fair_test_remote_post_response'] = array(
			'response' => array( 'code' => $status ),
			'body'     => wp_json_encode( $body ),
		);
	}

	/** @return string[] Meta event IDs sent, in order. */
	private function sent_event_ids() {
		return array_map(
			static fn( $request ) => json_decode( $request['args']['body'], true )['data'][0]['event_id'],
			$GLOBALS['_fair_test_remote_post_requests']
		);
	}

	/**
	 * A worker whose clock advances `$step` seconds per reading.
	 *
	 * @param float $step Seconds per reading.
	 * @return Conversions
	 */
	private function worker( $step = 0.0 ) {
		return new class( $step ) extends Conversions {
			/** @var float */
			private $step;
			/** @var float */
			private $clock = 0.0;

			/** @param float $step Seconds per reading. */
			public function __construct( $step ) {
				$this->step = $step;
			}

			/** @return float */
			protected function now() {
				$now          = $this->clock;
				$this->clock += $this->step;
				return $now;
			}
		};
	}

	/** Claim takes a token lease and counts the attempt. */
	public function test_claim_takes_a_token_lease_and_counts_the_attempt() {
		$id  = $this->db->add();
		$row = ( new Outbox() )->claim_due();

		$this->assertSame( $id, $row->id );
		$this->assertSame( 'sending', $row->state );
		$this->assertMatchesRegularExpression( '/^[a-f0-9]{32}$/', $row->claim_token );
		$this->assertSame( 1, $row->attempt_count );
		$lease = strtotime( $row->claim_expires_at . ' UTC' );
		$this->assertEqualsWithDelta( time() + Outbox::LEASE_SECONDS, $lease, 2 );
		// Nothing else is due, and the active lease is not reclaimed.
		$this->assertNull( ( new Outbox() )->claim_due() );
	}

	/** Contention is reported apart from an empty queue. */
	public function test_contention_is_reported_apart_from_an_empty_queue() {
		$outbox = new Outbox();
		$this->assertNull( $outbox->claim_due() );
		$this->assertFalse( $outbox->contended() );

		$this->db->add();
		$this->db->steal = 1;
		$this->assertNull( $outbox->claim_due() );
		$this->assertTrue( $outbox->contended() );
		$this->assertSame( 'other-worker', $this->db->rows[1]['claim_token'] );
	}

	/** Contended claim moves on to the next row. */
	public function test_contended_claim_moves_on_to_the_next_row() {
		$this->db->add();
		$second          = $this->db->add();
		$this->db->steal = 1;
		$this->assertSame( $second, ( new Outbox() )->claim_due()->id );
	}

	/** Expired claim is recovered with the same event identity. */
	public function test_expired_claim_is_recovered_with_the_same_event_identity() {
		$id    = $this->db->add(
			array(
				'state'            => 'sending',
				'claim_token'      => str_repeat( 'b', 32 ),
				'claim_expires_at' => self::EXPIRED,
				'attempt_count'    => 2,
			)
		);
		$event = $this->db->rows[ $id ]['event_id'];

		$row = ( new Outbox() )->claim_due();

		$this->assertSame( $id, $row->id );
		$this->assertNotSame( str_repeat( 'b', 32 ), $row->claim_token );
		$this->assertSame( 3, $row->attempt_count );
		$this->assertSame( $event, $row->event_id );
	}

	/** Every `immediate_*` state, and active claims, are never claimed. */
	public function test_immediate_rows_and_active_claims_are_not_recovered() {
		$this->db->add(
			array(
				'state'            => Outbox::IMMEDIATE_SENDING,
				'claim_expires_at' => self::EXPIRED,
			)
		);
		$this->db->add(
			array(
				'state'            => 'sending',
				'claim_token'      => str_repeat( 'c', 32 ),
				'claim_expires_at' => '2026-01-01 00:04:00',
				'attempt_count'    => 1,
			)
		);
		$this->assertNull( ( new Outbox() )->claim_due() );
	}

	/** Stale worker cannot overwrite a recovered claim. */
	public function test_stale_worker_cannot_overwrite_a_recovered_claim() {
		$this->db->add();
		$outbox = new Outbox();
		$stale  = $outbox->claim_due();
		// The lease runs out and another worker recovers the row.
		$this->db->rows[1]['claim_expires_at'] = self::EXPIRED;
		$fresh                                 = $outbox->claim_due();

		$this->assertFalse( $outbox->finish( $stale, 'received' ) );
		$this->assertFalse( $outbox->retry( $stale ) );
		$this->assertSame( 'sending', $this->db->rows[1]['state'] );
		$this->assertSame( $fresh->claim_token, $this->db->rows[1]['claim_token'] );

		$this->assertTrue( $outbox->finish( $fresh, 'received' ) );
		$this->assertSame( 'received', $this->db->rows[1]['state'] );
		$this->assertNull( $this->db->rows[1]['claim_token'] );
		$this->assertNull( $this->db->rows[1]['fbp'] );
	}

	/**
	 * Retries keep the existing delays and stop after six attempts.
	 *
	 * @param int $attempt Attempt that failed, as the claim counted it.
	 * @param int $delay   Expected seconds to the next attempt.
	 */
	#[\PHPUnit\Framework\Attributes\TestWith( array( 1, 60 ) )]
	#[\PHPUnit\Framework\Attributes\TestWith( array( 5, 43200 ) )]
	public function test_retry_keeps_the_existing_delays( $attempt, $delay ) {
		$this->db->add( array( 'attempt_count' => $attempt - 1 ) );
		$outbox = new Outbox();
		$this->assertTrue( $outbox->retry( $outbox->claim_due(), '2', 'oauthexception' ) );
		$row = $this->db->rows[1];
		$this->assertSame( 'retry_pending', $row['state'] );
		$this->assertSame( $attempt, $row['attempt_count'] );
		$this->assertEqualsWithDelta( time() + $delay, strtotime( $row['next_attempt_at'] . ' UTC' ), 2 );
		$this->assertNull( $row['claim_token'] );
	}

	/** Sixth failed attempt exhausts retries. */
	public function test_sixth_failed_attempt_exhausts_retries() {
		$this->db->add( array( 'attempt_count' => 5 ) );
		$outbox = new Outbox();
		$outbox->retry( $outbox->claim_due() );
		$this->assertSame( 'retries_exhausted', $this->db->rows[1]['state'] );
		$this->assertSame( 6, $this->db->rows[1]['attempt_count'] );
	}

	/** Interruptions consume the allowance: a claim interrupted on its last attempt is never resent. */
	public function test_interrupted_last_attempt_is_finished_without_resending() {
		$this->db->add(
			array(
				'state'            => 'sending',
				'claim_token'      => str_repeat( 'd', 32 ),
				'claim_expires_at' => self::EXPIRED,
				'attempt_count'    => Outbox::MAX_ATTEMPTS,
				'meta_diagnostics' => '{"http_status":503}',
			)
		);
		$this->worker()->deliver_due();

		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
		$row = $this->db->rows[1];
		$this->assertSame( 'retries_exhausted', $row['state'] );
		$this->assertSame( 'interrupted', $row['result_category'] );
		// No answer was received for the interrupted attempt.
		$this->assertNull( $row['meta_diagnostics'] );
		$this->assertNull( $row['fbp'] );
	}

	/** Repeated interruptions stop at the attempt limit. */
	public function test_repeated_interruptions_stop_at_the_attempt_limit() {
		$this->db->add();
		$outbox = new Outbox();
		$claims = 0;
		while ( $outbox->claim_due() ) {
			++$claims;
			$this->db->rows[1]['claim_expires_at'] = self::EXPIRED;
		}
		$this->assertSame( Outbox::MAX_ATTEMPTS, $claims );
		$outbox->expire_exhausted_claims();
		$this->assertSame( 'retries_exhausted', $this->db->rows[1]['state'] );
	}

	/** Worker stops after the row limit and schedules the rest. */
	public function test_worker_stops_after_the_row_limit_and_schedules_the_rest() {
		for ( $i = 0; $i < Conversions::WORKER_ROW_LIMIT + 5; $i++ ) {
			$this->db->add();
		}
		$this->worker()->deliver_due();

		$this->assertCount( Conversions::WORKER_ROW_LIMIT, $GLOBALS['_fair_test_remote_post_requests'] );
		$this->assertCount( 5, array_filter( $this->db->rows, static fn( $row ) => 'pending' === $row['state'] ) );
		$wakeups = DeliverySchedule::wakeups();
		$this->assertCount( 1, $wakeups );
		$this->assertLessThanOrEqual( time(), $wakeups[0]['timestamp'] );
	}

	/** Each send may take its full HTTP timeout, so a slow run stops claiming early. */
	public function test_worker_reserves_time_for_each_send() {
		for ( $i = 0; $i < 5; $i++ ) {
			$this->db->add();
		}
		// Four seconds pass per clock reading: claims at 4 and 8 seconds
		// leave room for a ten-second send and the final updates; 12 does not.
		$this->worker( 4.0 )->deliver_due();

		$this->assertCount( 2, $GLOBALS['_fair_test_remote_post_requests'] );
		$this->assertNotEmpty( DeliverySchedule::wakeups() );
	}

	/** A worker that dies after sending leaves its claim covered by a wake-up. */
	public function test_worker_schedules_a_recovery_wake_up_before_sending() {
		$this->db->add();
		$this->db->fail_update = 'Database gone';
		try {
			$this->worker()->deliver_due();
			$this->fail( 'The worker failure should surface.' );
		} catch ( \RuntimeException $e ) {
			$this->assertSame( 'Database gone', $e->getMessage() );
		}

		$lease   = strtotime( $this->db->rows[1]['claim_expires_at'] . ' UTC' );
		$at_send = array_keys( $GLOBALS['_fair_test_remote_post_requests'][0]['cron'] );
		$this->assertCount( 1, $at_send );
		$this->assertLessThanOrEqual( $lease, $at_send[0] );
		// Reconciled after the failure too: the claim stays covered.
		$this->assertLessThanOrEqual( $lease, DeliverySchedule::wakeups()[0]['timestamp'] );
	}

	/** Worker retry keeps event identity and wakes for it. */
	public function test_worker_retry_keeps_event_identity_and_wakes_for_it() {
		$this->db->add();
		$this->meta_answers( 503, array( 'error' => array( 'message' => 'Busy' ) ) );
		$this->worker()->deliver_due();

		$row = $this->db->rows[1];
		$this->assertSame( 'retry_pending', $row['state'] );
		$this->assertSame( 1, $row['attempt_count'] );
		$this->assertSame( 503, json_decode( $row['meta_diagnostics'], true )['http_status'] );
		$retry = strtotime( $row['next_attempt_at'] . ' UTC' );
		$this->assertLessThanOrEqual( $retry, DeliverySchedule::wakeups()[0]['timestamp'] );

		// The retry sends the same Meta event ID.
		$this->db->rows[1]['next_attempt_at'] = '2026-01-01 00:00:00';
		$this->meta_answers( 200, array( 'events_received' => 1 ) );
		$this->worker()->deliver_due();
		$this->assertSame( array( $row['event_id'], $row['event_id'] ), $this->sent_event_ids() );
		$this->assertSame( 'received', $this->db->rows[1]['state'] );
		$this->assertSame( 2, $this->db->rows[1]['attempt_count'] );
	}

	/** Meta's warnings on a confirmed receipt are kept with the outcome. */
	public function test_confirmed_receipt_keeps_meta_warnings() {
		$this->db->add();
		$this->meta_answers(
			200,
			array(
				'events_received' => 1,
				'messages'        => array( 'Event fbp fb.1.1712345678901.browser has low match quality' ),
				'fbtrace_id'      => 'TraceOk123',
			)
		);
		$this->worker()->deliver_due();

		$diagnostics = json_decode( $this->db->rows[1]['meta_diagnostics'], true );
		$this->assertSame( 'received', $this->db->rows[1]['state'] );
		$this->assertSame(
			array(
				'http_status'     => 200,
				'events_received' => 1,
				'messages'        => array( 'Event fbp [redacted] has low match quality' ),
				'fbtrace_id'      => 'TraceOk123',
			),
			$diagnostics
		);
	}

	/** Each row is sent once by concurrent workers. */
	public function test_each_row_is_sent_once_by_concurrent_workers() {
		for ( $i = 0; $i < 3; $i++ ) {
			$this->db->add();
		}
		// Another worker wins the first claim and is still sending it.
		$this->db->steal = 1;
		$this->worker()->deliver_due();
		$this->worker()->deliver_due();

		$sent = $this->sent_event_ids();
		$this->assertSame( array_unique( $sent ), $sent );
		$this->assertCount( 2, $sent );
		$this->assertNotContains( $this->db->rows[1]['event_id'], $sent );
		$this->assertSame( 'other-worker', $this->db->rows[1]['claim_token'] );
	}
}
