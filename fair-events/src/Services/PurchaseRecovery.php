<?php
/**
 * Purchase recovery queue
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\PaymentShadowWork;

defined( 'WPINC' ) || die;

/**
 * Finishes purchase work a request couldn't complete
 * (PAYMENT_HISTORY_MIGRATION.md §8.19). Work lives in
 * fair_events_payment_shadow_work, unique per (kind, source), and is removed
 * once it succeeds; a failed or unresolved attempt stays with its reason and
 * is retried with a growing delay (PaymentShadowWork::retry_delay()):
 *
 * - The purchase lifecycle's own work (PaymentShadowWork::lifecycle_kinds()):
 *   paid or failed notifications applied in part, confirmations and Fair
 *   Audience projections not yet announced.
 * - A Fair Audience relationship an organizer changed (queue_relationship()):
 *   its purchase is brought in step at the end of the request, after the
 *   writer's own database transaction, and retried from here when that fails.
 * - A transaction's payment links, for rows queued before the shadow writes
 *   were retired (#2253). Nothing queues these any more: every checkout
 *   records its links itself (PurchaseLifecycle::record_attempt()).
 *
 * Every step is idempotent, so retrying work that already succeeded in part
 * never duplicates a purchase, a link, a confirmation or a notification.
 */
class PurchaseRecovery {

	/**
	 * Cron hook that retries due work.
	 */
	const CRON_HOOK = 'fair_events_purchase_recovery';

	/**
	 * Cron recurrence name.
	 */
	const CRON_SCHEDULE = 'fair_events_fifteen_minutes';

	/**
	 * Most queue rows processed per run.
	 */
	const BATCH_SIZE = 50;

	/**
	 * Relationships queued by this request, processed at shutdown.
	 *
	 * @var array<int, true>
	 */
	private static $queued = array();

	/**
	 * Whether the shutdown processor is registered.
	 *
	 * @var bool
	 */
	private static $shutdown_registered = false;

	/**
	 * Register hooks and keep the retry cron scheduled.
	 *
	 * @return void
	 */
	public static function init() {
		add_filter( 'cron_schedules', array( static::class, 'add_cron_schedule' ) );
		add_action( self::CRON_HOOK, array( static::class, 'run_scheduled' ) );
		add_action( 'init', array( static::class, 'maybe_schedule' ), 20 );
	}

	/**
	 * Add the fifteen-minute recurrence.
	 *
	 * @param array $schedules Schedules.
	 * @return array
	 */
	public static function add_cron_schedule( $schedules ) {
		if ( ! isset( $schedules[ self::CRON_SCHEDULE ] ) ) {
			$schedules[ self::CRON_SCHEDULE ] = array(
				'interval' => 15 * MINUTE_IN_SECONDS,
				'display'  => 'Every fifteen minutes',
			);
		}
		return $schedules;
	}

	/**
	 * Schedule the retry cron once the work queue exists.
	 *
	 * @return void
	 */
	public static function maybe_schedule() {
		if ( self::queue_available() ) {
			\FairEvents\Core\Cron::ensure_recurring( self::CRON_HOOK, self::CRON_SCHEDULE, time() + MINUTE_IN_SECONDS );
		}
	}

	/**
	 * Remove the retry cron, on deactivation. Queued work stays.
	 *
	 * @return void
	 */
	public static function unschedule() {
		wp_clear_scheduled_hook( self::CRON_HOOK );
	}

	/**
	 * Whether the work queue exists.
	 *
	 * @return bool
	 */
	public static function queue_available() {
		return PaymentHistoryCompatibility::storage_available()
			&& version_compare( \FairEvents\Database\Schema::get_db_version(), PaymentHistoryCompatibility::SHADOW_DB_VERSION, '>=' );
	}

	/**
	 * A Fair Audience relationship changed: bring its purchase in step when
	 * the request ends. The row is written at once, so it is rolled back
	 * with a writer's database transaction that fails, and a request that
	 * dies before shutdown leaves it for the retry cron.
	 *
	 * @param int $relationship_id Fair Audience relationship ID.
	 * @return void
	 */
	public static function queue_relationship( $relationship_id ) {
		$relationship_id = (int) $relationship_id;
		if ( $relationship_id <= 0 || ! self::queue_available() ) {
			return;
		}

		PaymentShadowWork::enqueue( PaymentShadowWork::KIND_RELATIONSHIP, $relationship_id );
		self::$queued[ $relationship_id ] = true;

		if ( ! self::$shutdown_registered ) {
			self::$shutdown_registered = true;
			add_action( 'shutdown', array( static::class, 'process_queued' ), 1 );
		}
	}

	/**
	 * Shutdown: bring the relationships this request changed in step.
	 *
	 * @return void
	 */
	public static function process_queued() {
		$queued       = self::$queued;
		self::$queued = array();

		// After a fatal error a writer may have left a database transaction
		// open; starting another one would commit its partial work. The
		// queued rows wait for the retry cron instead.
		$error = error_get_last();
		if ( $error && in_array( $error['type'], array( E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR ), true ) ) {
			return;
		}

		foreach ( array_keys( $queued ) as $relationship_id ) {
			// Work queued inside a database transaction its writer rolled
			// back is gone, together with the change it was about.
			if ( PaymentShadowWork::get( PaymentShadowWork::KIND_RELATIONSHIP, (int) $relationship_id ) ) {
				self::process( PaymentShadowWork::KIND_RELATIONSHIP, (int) $relationship_id );
			}
		}
	}

	/**
	 * Cron: retry due work.
	 *
	 * @return void
	 */
	public static function run_scheduled() {
		if ( self::queue_available() ) {
			self::process_due( self::BATCH_SIZE );
		}
	}

	/**
	 * Process queue rows whose next attempt is due, relationships first so
	 * the purchases a transaction's links need exist.
	 *
	 * @param int $limit Most rows.
	 * @return int Rows processed.
	 */
	public static function process_due( $limit ) {
		$rows = PaymentShadowWork::get_due( $limit );
		usort(
			$rows,
			static function ( $a, $b ) {
				return array( PaymentShadowWork::KIND_RELATIONSHIP === $a['kind'] ? 0 : 1, (int) $a['id'] )
					<=> array( PaymentShadowWork::KIND_RELATIONSHIP === $b['kind'] ? 0 : 1, (int) $b['id'] );
			}
		);

		foreach ( $rows as $row ) {
			self::process( (string) $row['kind'], (int) $row['source_id'] );
		}
		return count( $rows );
	}

	/**
	 * Do one piece of work and record its outcome in the queue.
	 *
	 * @param string $kind      Kind.
	 * @param int    $source_id Source ID.
	 * @return string Outcome: done, failed or unresolved.
	 */
	public static function process( $kind, $source_id ) {
		$source_id = (int) $source_id;

		try {
			if ( in_array( $kind, PaymentShadowWork::lifecycle_kinds(), true ) ) {
				return PurchaseLifecycle::process_work( $kind, $source_id );
			}

			if ( PaymentShadowWork::KIND_RELATIONSHIP === $kind ) {
				$result = PurchaseLifecycle::record_relationship( $source_id );
				if ( is_wp_error( $result ) ) {
					PaymentShadowWork::defer( $kind, $source_id, PaymentShadowWork::STATUS_FAILED, $result->get_error_code(), array( 'message' => $result->get_error_message() ) );
					return 'failed';
				}
				PaymentShadowWork::complete( $kind, $source_id );
				return 'done';
			}

			if ( PaymentShadowWork::KIND_TRANSACTION === $kind ) {
				$result = PurchaseLifecycle::record_attempt( $source_id );
				if ( ! is_wp_error( $result ) ) {
					// record_attempt() removed the row.
					return 'done';
				}
				$code       = $result->get_error_code();
				$detail     = (array) $result->get_error_data();
				$unresolved = in_array( $code, array( 'missing_transaction', 'payment_attempt_unattributed' ), true );
				PaymentShadowWork::defer(
					$kind,
					$source_id,
					$unresolved ? PaymentShadowWork::STATUS_UNRESOLVED : PaymentShadowWork::STATUS_FAILED,
					'payment_attempt_unattributed' === $code && ! empty( $detail['reason'] ) ? (string) $detail['reason'] : $code,
					$detail
				);
				return $unresolved ? 'unresolved' : 'failed';
			}
		} catch ( \Throwable $error ) {
			PaymentShadowWork::defer( $kind, $source_id, PaymentShadowWork::STATUS_FAILED, 'recovery_exception', array( 'message' => $error->getMessage() ) );
			return 'failed';
		}

		// An unknown kind can't be done; leave it out of the retries.
		PaymentShadowWork::complete( $kind, $source_id );
		return 'done';
	}
}
