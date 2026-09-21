<?php
/**
 * Digest sender hooks for Fair Payments Connector Experimental
 *
 * Registers custom WP-Cron intervals and one recurring event per digest
 * frequency. Each run claims the queued rows of its frequency, grouped by
 * route, and sends one combined digest per group.
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Hooks;

use FairPaymentsConnectorExperimental\Services\DigestBuilder;
use FairPaymentsConnectorExperimental\Services\NotificationQueue;

defined( 'WPINC' ) || die;

/**
 * Drives the periodic digest flush via WP-Cron.
 */
class DigestHooks {

	const CRON_HOOK     = 'fair_payment_flush_digest';
	const STUCK_MINUTES = 30;

	/**
	 * Frequencies that map to WP-Cron schedule names.
	 */
	const FREQUENCY_SCHEDULES = array(
		'hourly' => 'fair_payment_digest_hourly',
		'daily'  => 'fair_payment_digest_daily',
		'weekly' => 'fair_payment_digest_weekly',
	);

	/**
	 * Length in seconds of each frequency's schedule.
	 */
	const FREQUENCY_INTERVALS = array(
		'hourly' => HOUR_IN_SECONDS,
		'daily'  => DAY_IN_SECONDS,
		'weekly' => WEEK_IN_SECONDS,
	);

	/**
	 * Queue storage.
	 *
	 * @var NotificationQueue
	 */
	private $queue;

	/**
	 * Builds a channel for a channel name.
	 *
	 * @var callable
	 */
	private $channel_factory;

	/**
	 * Constructor.
	 *
	 * @param NotificationQueue|null $queue           Queue storage; defaults to the database-backed queue.
	 * @param callable|null          $channel_factory Receives a channel name, returns a NotificationChannel or null.
	 */
	public function __construct( ?NotificationQueue $queue = null, ?callable $channel_factory = null ) {
		$this->queue           = $queue ?? new NotificationQueue();
		$this->channel_factory = $channel_factory ?? array( NotificationHooks::class, 'make_channel' );
	}

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public function init() {
		add_filter( 'cron_schedules', array( $this, 'add_cron_schedules' ) );
		add_action( self::CRON_HOOK, array( $this, 'flush_due' ) );

		$this->schedule_events();
	}

	/**
	 * Make sure one recurring event exists per digest frequency.
	 *
	 * Each event carries its frequency as its only argument, so the events are
	 * independent: a missing one is re-created without touching the others.
	 * The single argument-less hourly event registered by earlier versions,
	 * which flushed every frequency at once, is removed.
	 *
	 * @return void
	 */
	public function schedule_events() {
		if ( false !== wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_clear_scheduled_hook( self::CRON_HOOK );
		}

		foreach ( self::FREQUENCY_SCHEDULES as $frequency => $schedule ) {
			if ( false === wp_next_scheduled( self::CRON_HOOK, array( $frequency ) ) ) {
				wp_schedule_event( time() + self::FREQUENCY_INTERVALS[ $frequency ], $schedule, self::CRON_HOOK, array( $frequency ) );
			}
		}
	}

	/**
	 * Register custom WP-Cron intervals for digest frequencies.
	 *
	 * @param array $schedules Existing schedules.
	 * @return array
	 */
	public function add_cron_schedules( $schedules ) {
		if ( ! isset( $schedules['fair_payment_digest_hourly'] ) ) {
			$schedules['fair_payment_digest_hourly'] = array(
				'interval' => HOUR_IN_SECONDS,
				'display'  => __( 'Every hour (fair-payments digest)', 'fair-payments-connector-experimental' ),
			);
		}
		if ( ! isset( $schedules['fair_payment_digest_daily'] ) ) {
			$schedules['fair_payment_digest_daily'] = array(
				'interval' => DAY_IN_SECONDS,
				'display'  => __( 'Every day (fair-payments digest)', 'fair-payments-connector-experimental' ),
			);
		}
		if ( ! isset( $schedules['fair_payment_digest_weekly'] ) ) {
			$schedules['fair_payment_digest_weekly'] = array(
				'interval' => WEEK_IN_SECONDS,
				'display'  => __( 'Every week (fair-payments digest)', 'fair-payments-connector-experimental' ),
			);
		}
		return $schedules;
	}

	/**
	 * Send the queued digests of one frequency.
	 *
	 * Rows are grouped by route and claimed atomically before sending, so an
	 * overlapping run cannot include the same sale again. A group is marked sent
	 * only after its channel reports success; otherwise its rows return to
	 * `pending` with the attempt recorded and are retried on the next run. A
	 * claim left in `sending` for over STUCK_MINUTES (a run that died mid-send)
	 * becomes claimable again.
	 *
	 * @param string $frequency Digest frequency: hourly, daily or weekly.
	 * @return void
	 */
	public function flush_due( $frequency = '' ) {
		$frequency = (string) $frequency;
		if ( ! isset( self::FREQUENCY_SCHEDULES[ $frequency ] ) ) {
			return;
		}

		$stale_before = gmdate( 'Y-m-d H:i:s', time() - self::STUCK_MINUTES * MINUTE_IN_SECONDS );

		foreach ( $this->queue->due_groups( $frequency, $stale_before ) as $group ) {
			$token = bin2hex( random_bytes( 16 ) );
			$rows  = $this->queue->claim_group( $group, $frequency, $stale_before, $token, gmdate( 'Y-m-d H:i:s' ) );

			if ( empty( $rows ) ) {
				// Another run claimed this group first.
				continue;
			}

			$this->deliver( $group, $rows, $token );
		}
	}

	/**
	 * Send one claimed group and record the outcome.
	 *
	 * Uses the channel and destination captured when the sales were queued, and
	 * keeps message bodies and recipients out of the stored failure text.
	 *
	 * @param object   $group Group with channel and destination.
	 * @param object[] $rows  Claimed queue rows.
	 * @param string   $token Claim token.
	 * @return void
	 */
	private function deliver( $group, array $rows, string $token ) {
		$channel = call_user_func( $this->channel_factory, (string) $group->channel );

		if ( null === $channel ) {
			$this->queue->release( $token, 'Unknown notification channel.' );
			return;
		}

		$error = 'Channel reported a failed send.';

		try {
			$sent = $channel->send( (string) $group->destination, ( new DigestBuilder() )->build( $rows ) );
		} catch ( \Throwable $e ) {
			$sent  = false;
			$error = 'Send raised ' . get_class( $e ) . '.';
		}

		if ( true === $sent ) {
			$this->queue->mark_sent( $token, gmdate( 'Y-m-d H:i:s' ) );
			return;
		}

		$this->queue->release( $token, $error );
	}
}
