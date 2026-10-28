<?php
/**
 * Meta delivery schedule tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\Conversions;
use FairEventsExperimental\Meta\DeliverySchedule;
use FairEventsExperimental\Meta\Outbox;
use PHPUnit\Framework\TestCase;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/** Covers wake-up reconciliation, failures and recovery. */
class DeliveryScheduleTest extends TestCase {
	/** Reset the fake cron and options. */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_cron']       = array();
		$GLOBALS['_fair_test_cron_fails'] = false;
		$GLOBALS['_fair_test_options']    = array();
	}

	/** Clear the scheduling failure switch. */
	protected function tearDown(): void {
		$GLOBALS['_fair_test_cron_fails'] = false;
		parent::tearDown();
	}

	/**
	 * An outbox whose outstanding work is next due at `$due`.
	 *
	 * @param int|null $due Unix timestamp, or null without work.
	 * @return Outbox
	 */
	private function outbox( $due ) {
		return new class( $due ) extends Outbox {
			/** @var int|null */
			public $due;
			/** @var int */
			public $reads = 0;

			/** @param int|null $due Next due time. */
			public function __construct( $due ) {
				$this->due = $due;
			}

			/** @return int|null */
			public function next_wake_at() {
				++$this->reads;
				return $this->due;
			}
		};
	}

	/** @return int[] Scheduled wake-up timestamps. */
	private function scheduled() {
		return array_column( DeliverySchedule::wakeups(), 'timestamp' );
	}

	/** @param int $timestamp Run time. @param array $args Arguments. */
	private function schedule( $timestamp, $args ) {
		wp_schedule_single_event( $timestamp, Conversions::DELIVERY_HOOK, $args );
	}

	/** Empty queue schedules nothing. */
	public function test_empty_queue_schedules_nothing() {
		$this->assertTrue( ( new DeliverySchedule( $this->outbox( null ) ) )->reconcile() );
		$this->assertSame( array(), $this->scheduled() );
	}

	/** Missing schedule is restored for pending work. */
	public function test_missing_schedule_is_restored_for_pending_work() {
		$due = time() + 120;
		$this->assertTrue( ( new DeliverySchedule( $this->outbox( $due ) ) )->reconcile() );
		$this->assertSame(
			array(
				array(
					'timestamp' => $due,
					'args'      => array( $due ),
				),
			),
			DeliverySchedule::wakeups()
		);
	}

	/** Overdue work is scheduled now. */
	public function test_overdue_work_is_scheduled_now() {
		$before = time();
		( new DeliverySchedule( $this->outbox( $before - 3600 ) ) )->reconcile();
		$this->assertGreaterThanOrEqual( $before, $this->scheduled()[0] );
		$this->assertLessThanOrEqual( time(), $this->scheduled()[0] );
	}

	/** A new conversion is not held back by an unrelated retry, near or distant. */
	#[\PHPUnit\Framework\Attributes\TestWith( array( 300 ) )]
	#[\PHPUnit\Framework\Attributes\TestWith( array( 43200 ) )]
	public function test_new_work_brings_a_later_retry_forward( $retry_in ) {
		$retry = time() + $retry_in;
		$this->schedule( $retry, array( $retry ) );
		$now = time();
		$this->assertTrue( ( new DeliverySchedule( $this->outbox( $retry ) ) )->ensure_by( $now ) );
		$this->assertCount( 1, $this->scheduled() );
		$this->assertLessThanOrEqual( $now + 1, $this->scheduled()[0] );
	}

	/** A wake up queued before arguments existed still counts. */
	public function test_a_wake_up_queued_before_arguments_existed_still_counts() {
		$legacy = time() + 30;
		$this->schedule( $legacy, array() );
		$this->assertTrue( ( new DeliverySchedule( $this->outbox( time() + 60 ) ) )->reconcile() );
		$this->assertSame( array( $legacy ), $this->scheduled() );

		// And it is replaced when earlier work arrives.
		( new DeliverySchedule( $this->outbox( null ) ) )->ensure_by( time() );
		$this->assertCount( 1, $this->scheduled() );
		$this->assertLessThan( $legacy, $this->scheduled()[0] );
	}

	/** An earlier wake up is never removed. */
	public function test_an_earlier_wake_up_is_never_removed() {
		$earlier = time() + 60;
		$this->schedule( $earlier, array( $earlier ) );
		$this->assertTrue( ( new DeliverySchedule( $this->outbox( null ) ) )->ensure_by( time() + 1800 ) );
		$this->assertSame( array( $earlier ), $this->scheduled() );
	}

	/** Repeated reconciliation does not accumulate jobs. */
	public function test_repeated_reconciliation_does_not_accumulate_jobs() {
		$schedule = new DeliverySchedule( $this->outbox( time() + 300 ) );
		$schedule->reconcile();
		$schedule->reconcile();
		$schedule->ensure_by( time() + 300 );
		$this->assertCount( 1, $this->scheduled() );
	}

	/** Failure is recorded and the existing wake up kept. */
	public function test_failure_is_recorded_and_the_existing_wake_up_kept() {
		$retry = time() + 1800;
		$this->schedule( $retry, array( $retry ) );
		$GLOBALS['_fair_test_cron_fails'] = true;

		$this->assertFalse( ( new DeliverySchedule( $this->outbox( null ) ) )->ensure_by( time() ) );

		$this->assertSame( array( $retry ), $this->scheduled() );
		$status = DeliverySchedule::status();
		$this->assertFalse( $status['healthy'] );
		$this->assertSame( 'could_not_set', $status['last_failure_code'] );
		$this->assertSame( '2026-01-01 00:00:00', $status['last_failure_at'] );
		$this->assertNotEmpty( $status['last_failure_at_local'] );
	}

	/** Recovery clears the active failure and keeps its time. */
	public function test_recovery_clears_the_active_failure_and_keeps_its_time() {
		$GLOBALS['_fair_test_cron_fails'] = true;
		$outbox                           = $this->outbox( time() );
		$this->assertFalse( ( new DeliverySchedule( $outbox ) )->reconcile_if_needed() );
		$this->assertSame( array(), $this->scheduled() );

		// The next request finds no wake-up and an active failure, and retries.
		$GLOBALS['_fair_test_cron_fails'] = false;
		$this->assertTrue( ( new DeliverySchedule( $outbox ) )->reconcile_if_needed() );

		$this->assertCount( 1, $this->scheduled() );
		$status = DeliverySchedule::status();
		$this->assertTrue( $status['healthy'] );
		$this->assertSame( '2026-01-01 00:00:00', $status['last_failure_at'] );
	}

	/** Request check reads the outbox only when needed. */
	public function test_request_check_reads_the_outbox_only_when_needed() {
		$outbox = $this->outbox( time() + 60 );
		( new DeliverySchedule( $outbox ) )->reconcile_if_needed();
		$this->assertSame( 1, $outbox->reads );

		// A wake-up exists and scheduling is healthy: no query.
		( new DeliverySchedule( $outbox ) )->reconcile_if_needed();
		$this->assertSame( 1, $outbox->reads );
	}

	/** Failure code is sanitized and bounded. */
	public function test_failure_code_is_sanitized_and_bounded() {
		$GLOBALS['_fair_test_cron_fails'] = true;
		( new DeliverySchedule( $this->outbox( time() ) ) )->reconcile();
		$stored = get_option( DeliverySchedule::FAILURE_OPTION );
		$this->assertSame( array( 'active', 'code', 'failed_at' ), array_keys( $stored ) );
		$this->assertMatchesRegularExpression( '/^[a-z0-9_-]{1,40}$/', $stored['code'] );
	}

	/** Status without any failure. */
	public function test_status_without_any_failure() {
		$this->assertSame(
			array(
				'healthy'               => true,
				'last_failure_code'     => null,
				'last_failure_at'       => null,
				'last_failure_at_local' => null,
			),
			DeliverySchedule::status()
		);
	}

	/** A worker's claim wake-up gives way to the next retry once it reconciles. */
	public function test_claim_wake_up_is_released_for_a_later_retry() {
		$lease    = time() + Outbox::LEASE_SECONDS;
		$retry    = time() + 43200;
		$schedule = new DeliverySchedule( $this->outbox( $retry ) );
		$this->assertTrue( $schedule->cover_claim( $lease ) );
		$this->assertSame( array( $lease ), $this->scheduled() );

		$this->assertTrue( $schedule->reconcile() );
		$this->assertSame( array( $retry ), $this->scheduled() );
	}

	/** A claim still held after the run keeps its exactly matching wake-up. */
	public function test_claim_wake_up_stays_for_a_claim_still_held() {
		$lease    = time() + Outbox::LEASE_SECONDS;
		$schedule = new DeliverySchedule( $this->outbox( $lease ) );
		$schedule->cover_claim( $lease );
		$this->assertTrue( $schedule->reconcile() );
		$this->assertSame( array( $lease ), $this->scheduled() );
		$this->assertTrue( DeliverySchedule::status()['healthy'] );
	}

	/** Without outstanding work only the worker's own wake-ups are removed. */
	public function test_empty_queue_releases_only_claim_wake_ups() {
		$other = time() + 30;
		$this->schedule( $other, array( $other ) );
		$schedule = new DeliverySchedule( $this->outbox( null ) );
		// Already covered by the earlier wake-up: nothing of its own to release.
		$schedule->cover_claim( time() + Outbox::LEASE_SECONDS );
		$schedule->reconcile();
		$this->assertSame( array( $other ), $this->scheduled() );

		wp_unschedule_event( $other, Conversions::DELIVERY_HOOK, array( $other ) );
		$lease = time() + Outbox::LEASE_SECONDS;
		$schedule->cover_claim( $lease );
		$this->assertSame( array( $lease ), $this->scheduled() );
		$schedule->reconcile();
		$this->assertSame( array(), $this->scheduled() );
	}

	/** A claim wake-up stays as the fallback when its replacement fails. */
	public function test_claim_wake_up_is_kept_when_the_replacement_fails() {
		$lease    = time() + Outbox::LEASE_SECONDS;
		$schedule = new DeliverySchedule( $this->outbox( time() + 43200 ) );
		$schedule->cover_claim( $lease );
		$GLOBALS['_fair_test_cron_fails'] = true;
		$this->assertFalse( $schedule->reconcile() );
		$this->assertSame( array( $lease ), $this->scheduled() );
	}
}
