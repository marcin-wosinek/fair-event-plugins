<?php
/**
 * Ticket unit backfill for existing signups
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventSignup;
use FairEvents\Models\EventTicket;

defined( 'WPINC' ) || die;

/**
 * Creates ticket units for signups that predate them, in bounded,
 * restartable batches driven by WP-Cron.
 *
 * Progress is tracked in its own option, separately from the schema
 * version: a cursor over signup IDs plus a status. Batches reconcile each
 * signup against its quantity, so an interrupted batch is simply repeated.
 * Once the cursor reaches the end, the whole table is verified for missing
 * or excess units, and the backfill is marked complete only when that
 * verification comes back clean.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TicketBackfill {

	/**
	 * Progress option name.
	 */
	const OPTION = 'fair_events_ticket_backfill';

	/**
	 * Cron hook that runs one batch.
	 */
	const CRON_HOOK = 'fair_events_ticket_backfill_batch';

	/**
	 * Default number of signups per batch.
	 */
	const BATCH_SIZE = 200;

	/**
	 * Register the cron handler and resume an unfinished backfill.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( self::CRON_HOOK, array( static::class, 'run_scheduled_batch' ) );

		if ( 'running' === self::get_state()['status'] && ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_single_event( time(), self::CRON_HOOK );
		}
	}

	/**
	 * Start (or restart) the backfill from the first signup.
	 *
	 * @return void
	 */
	public static function start() {
		update_option(
			self::OPTION,
			array(
				'status'         => 'running',
				'last_signup_id' => 0,
				'completed_at'   => null,
			)
		);

		if ( function_exists( 'wp_next_scheduled' ) && ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_single_event( time(), self::CRON_HOOK );
		}
	}

	/**
	 * Current backfill progress.
	 *
	 * @return array{status: string, last_signup_id: int, completed_at: string|null}
	 *               status is 'not_started', 'running' or 'complete'.
	 */
	public static function get_state() {
		$state = get_option( self::OPTION, array() );
		$state = is_array( $state ) ? $state : array();

		return array(
			'status'         => (string) ( $state['status'] ?? 'not_started' ),
			'last_signup_id' => (int) ( $state['last_signup_id'] ?? 0 ),
			'completed_at'   => $state['completed_at'] ?? null,
		);
	}

	/**
	 * Cron handler: run one batch and queue the next until complete.
	 *
	 * @return void
	 */
	public static function run_scheduled_batch() {
		$state = self::run_batch();

		if ( 'running' === $state['status'] && ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_single_event( time() + MINUTE_IN_SECONDS, self::CRON_HOOK );
		}
	}

	/**
	 * Process one bounded batch of signups after the cursor. When no signups
	 * remain, verify the whole table and mark the backfill complete only if
	 * every signup owns exactly its quantity of units.
	 *
	 * @param int|null $batch_size Signups per batch; defaults to the filtered BATCH_SIZE.
	 * @return array Updated state (see get_state()).
	 */
	public static function run_batch( ?int $batch_size = null ) {
		global $wpdb;

		$state = self::get_state();
		if ( 'running' !== $state['status'] ) {
			return $state;
		}

		$batch_size = max( 1, (int) ( $batch_size ?? apply_filters( 'fair_events_ticket_backfill_batch_size', self::BATCH_SIZE ) ) );

		$signups = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id > %d ORDER BY id ASC LIMIT %d',
				$wpdb->prefix . 'fair_events_signups',
				$state['last_signup_id'],
				$batch_size
			)
		);

		foreach ( $signups as $signup ) {
			// Stop at the first failure without advancing past it, so the
			// next run retries the same signup.
			if ( false === EventTicket::reconcile_signup( $signup ) ) {
				return self::save_state( $state );
			}
			$state['last_signup_id'] = (int) $signup->id;
		}

		if ( count( $signups ) === $batch_size ) {
			return self::save_state( $state );
		}

		self::repair( $batch_size );

		$audit = self::audit( 1 );
		if ( ! $audit['missing'] && ! $audit['excess'] ) {
			$state['status']       = 'complete';
			$state['completed_at'] = gmdate( 'Y-m-d H:i:s' );
		}

		return self::save_state( $state );
	}

	/**
	 * Detect signups whose unit count does not match their quantity.
	 *
	 * @param int $limit Maximum signup IDs to list per category.
	 * @return array{missing: int[], excess: int[]} Signup IDs with too few units,
	 *               and signup IDs with units beyond their quantity or whose signup no longer exists.
	 */
	public static function audit( int $limit = 100 ) {
		return array(
			'missing' => EventTicket::find_signups_missing_units( $limit ),
			'excess'  => EventTicket::find_signups_with_excess_units( $limit ),
		);
	}

	/**
	 * Reconcile up to $limit mismatched signups found by audit(). Units whose
	 * signup no longer exists are removed.
	 *
	 * @param int $limit Maximum signups to repair per category.
	 * @return void
	 */
	private static function repair( int $limit ) {
		$audit = self::audit( $limit );

		foreach ( array_unique( array_merge( $audit['missing'], $audit['excess'] ) ) as $signup_id ) {
			$signup = EventSignup::get_by_id( $signup_id );
			if ( $signup ) {
				EventTicket::reconcile_signup( $signup );
			} else {
				EventTicket::delete_by_signup_id( $signup_id );
			}
		}
	}

	/**
	 * Persist state and return it.
	 *
	 * @param array $state State to save.
	 * @return array
	 */
	private static function save_state( array $state ) {
		update_option( self::OPTION, $state );

		return $state;
	}
}
