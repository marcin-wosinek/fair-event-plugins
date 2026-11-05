<?php
/**
 * Payment log retention hooks for Fair Payments Connector
 *
 * Registers one daily WP-Cron event that deletes payment log rows older than
 * the retention window.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Hooks;

use FairPaymentsConnector\Core\Cron;
use FairPaymentsConnector\Database\PaymentLogRepository;
use FairPaymentsConnector\Services\PaymentLogRetention;

defined( 'WPINC' ) || die;

/**
 * Drives the daily payment log pruning via WP-Cron.
 */
class PaymentLogRetentionHooks {

	const CRON_HOOK = 'fair_payment_prune_payment_log';

	/**
	 * Rows deleted per query.
	 */
	const BATCH_SIZE = 1000;

	/**
	 * Queries per run. Rows past BATCH_SIZE * MAX_BATCHES wait for the next run.
	 */
	const MAX_BATCHES = 10;

	/**
	 * Log storage.
	 *
	 * @var PaymentLogRepository
	 */
	private $repository;

	/**
	 * Constructor.
	 *
	 * @param PaymentLogRepository|null $repository Log storage; defaults to the database-backed repository.
	 */
	public function __construct( ?PaymentLogRepository $repository = null ) {
		$this->repository = $repository ?? new PaymentLogRepository();
	}

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public function init() {
		add_action( self::CRON_HOOK, array( $this, 'prune' ) );
		// Scheduling runs every plugin's translated `cron_schedules` labels.
		add_action( 'init', array( $this, 'schedule_event' ), 11 );
	}

	/**
	 * Make sure the daily event exists.
	 *
	 * Runs on every load, so sites updated without reactivation get the event
	 * too. The first run is due straight away, to start clearing rows that
	 * expired before the policy existed.
	 *
	 * @return true|string True when it is scheduled, or a failure code; a
	 *                     failure is tried again on the next request.
	 */
	public function schedule_event() {
		return Cron::ensure_recurring( self::CRON_HOOK, 'daily', time() );
	}

	/**
	 * Remove the scheduled event, whatever its arguments. Called on plugin
	 * deactivation.
	 *
	 * @return void
	 */
	public static function unschedule() {
		wp_unschedule_hook( self::CRON_HOOK );
	}

	/**
	 * Delete expired log rows in bounded batches.
	 *
	 * @return int|false Rows deleted, or false when a delete failed.
	 */
	public function prune() {
		$days    = PaymentLogRetention::days();
		$deleted = 0;

		for ( $batch = 0; $batch < self::MAX_BATCHES; $batch++ ) {
			$count = $this->repository->prune_older_than( $days, self::BATCH_SIZE );

			if ( false === $count ) {
				return false;
			}

			$deleted += $count;

			if ( $count < self::BATCH_SIZE ) {
				break;
			}
		}

		return $deleted;
	}
}
