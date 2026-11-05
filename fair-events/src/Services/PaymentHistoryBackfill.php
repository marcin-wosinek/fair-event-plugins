<?php
/**
 * Payment history backfill
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventTicket;
use FairEvents\Models\EventTicketActivity;
use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Models\PaymentShadowWork;
use FairEvents\Models\SignupPaymentLink;

defined( 'WPINC' ) || die;

/**
 * Migrates historical admissions, activities and payment attempts into
 * Events-owned history (PAYMENT_HISTORY_MIGRATION.md §4–6, §8.2–8.4, §8.9).
 *
 * An administrator first runs a dry run, which reaches the same conclusions
 * through the same rules but writes no purchase, unit, activity or link;
 * after reviewing it and confirming a database backup, they start the
 * backfill. Both run in bounded, serialized batches through WP-Cron, in
 * phases, each with an ID cursor saved after every batch:
 *
 * 1. admissions: legacy admissions become purchases (§4.1–4.3), each with
 *    its unit, activities, check-in and attributable links in one
 *    database transaction;
 * 2. activities: participant-scope activities go onto their purchase's
 *    unit, or are reported as `ambiguous_activity` (§4.4);
 * 3. transactions: every attempt is attributed (PaymentAttribution, the
 *    rules the live shadow writers use) and linked with
 *    `attribution = backfill`, or reported with its §6.2 reason;
 * 4. references: refund-labelled ledger rows are kept as
 *    `legacy_refund_record` links (§11); ledger rows and purchases naming
 *    deleted transactions are reported (`missing_transaction`);
 * 5. revisit (backfill only): relationships that were pending, and
 *    unresolved findings, are examined again;
 * 6. verify (backfill only): every event date is compared
 *    (PaymentHistoryVerification) and the migration is marked `verified`
 *    when nothing blocks (§8.4).
 *
 * The cutoffs are the shadow writes' coverage floors (§8.8): up to them
 * history is the backfill's, after them the live writers'. Every write is
 * idempotent through a unique key, so a repeated or interrupted batch
 * produces the same result. Source history is never changed: ledger rows,
 * relationships, participant-scope activities, transactions and existing
 * live or reconciled links stay as they are. Ownership doesn't switch and
 * Statistics keeps its readers.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PaymentHistoryBackfill {

	/**
	 * Cron hook that runs one batch.
	 */
	const CRON_HOOK = 'fair_events_payment_history_backfill_batch';

	/**
	 * Records per batch.
	 */
	const BATCH_SIZE = 100;

	/**
	 * Event dates compared per verification batch.
	 */
	const VERIFY_BATCH_SIZE = 25;

	const MODE_DRY_RUN  = PaymentHistoryFinding::MODE_DRY_RUN;
	const MODE_BACKFILL = PaymentHistoryFinding::MODE_BACKFILL;

	const STATUS_RUNNING             = 'running';
	const STATUS_PAUSED              = 'paused';
	const STATUS_COMPLETE            = 'complete';
	const STATUS_VERIFIED            = 'verified';
	const STATUS_VERIFICATION_FAILED = 'verification_failed';

	/**
	 * Phases per mode, in order.
	 */
	const PHASES = array(
		self::MODE_DRY_RUN  => array( 'admissions', 'activities', 'transactions', 'references', 'signup_references', 'summary' ),
		self::MODE_BACKFILL => array( 'admissions', 'activities', 'transactions', 'references', 'signup_references', 'revisit_admissions', 'revisit_findings', 'verify' ),
	);

	/**
	 * Link write errors that are a decision about the evidence, not a
	 * failure to retry: nothing was written and the record is reported.
	 */
	const LINK_DECISION_ERRORS = array( 'payment_link_conflict', 'allocation_exceeds_total', 'duplicate_payment_link', 'invalid_payment_link', 'invalid_payment_transaction', 'payment_link_unknown_purchase' );

	/**
	 * Finding reasons a revisit attributes again.
	 */
	const REVISIT_TRANSACTION_REASONS = array( 'no_evidence', 'allocation_mismatch', 'ambiguous_activity_charge', 'ambiguous_upgrade', 'participant_relationship_conflict', 'existing_link_conflict' );

	/**
	 * Register the cron handler; the shadow work cron keeps a run scheduled.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( self::CRON_HOOK, array( static::class, 'run_scheduled' ) );
		add_action( PaymentHistoryShadowWrites::CRON_HOOK, array( static::class, 'ensure_scheduled' ), 20 );
	}

	/**
	 * Everything an administrator needs to decide on and follow the
	 * migration.
	 *
	 * @return array
	 */
	public static function status() {
		$state = PaymentHistoryCompatibility::get_state();
		$runs  = array();
		foreach ( array( self::MODE_DRY_RUN, self::MODE_BACKFILL ) as $mode ) {
			$run = is_array( $state[ $mode ] ?? null ) ? $state[ $mode ] : null;
			if ( $run ) {
				$run['findings'] = PaymentHistoryFinding::count_open( $mode );
			}
			$runs[ $mode ] = $run;
		}

		return array(
			'blockers'          => PaymentHistoryCompatibility::backfill_blockers(),
			'cutoffs'           => self::cutoffs(),
			'dry_run'           => $runs[ self::MODE_DRY_RUN ],
			'backfill'          => $runs[ self::MODE_BACKFILL ],
			'shadow_work'       => PaymentHistoryCompatibility::storage_available() && PaymentHistoryCompatibility::shadow_writes_supported() ? PaymentShadowWork::count_outstanding() : array(),
			'comparisons'       => PaymentHistoryCompatibility::storage_available() ? PaymentHistoryVerification::summary() : null,
			'verified'          => PaymentHistoryCompatibility::migration_verified(),
			'ownership_cutover' => PaymentHistoryCompatibility::ownership_cutover(),
		);
	}

	/**
	 * Start a dry run, replacing the previous one's findings.
	 *
	 * @return array|\WP_Error The new run, or why it can't start.
	 */
	public static function start_dry_run() {
		$refused = self::refuse_start();
		if ( $refused ) {
			return $refused;
		}
		$dry_run = self::get_run( self::MODE_DRY_RUN );
		if ( $dry_run && self::STATUS_RUNNING === $dry_run['status'] ) {
			return new \WP_Error( 'dry_run_running', 'A dry run is already running.' );
		}

		PaymentHistoryFinding::clear( self::MODE_DRY_RUN );
		$run = self::new_run( self::MODE_DRY_RUN );
		self::save_run( self::MODE_DRY_RUN, $run );
		self::schedule();
		return $run;
	}

	/**
	 * Start the backfill, or run it again over the same cutoffs. Needs a
	 * completed dry run over these cutoffs and a confirmed backup.
	 *
	 * @param array $args backup_confirmed (bool), user_id (int).
	 * @return array|\WP_Error The new run, or why it can't start.
	 */
	public static function start( array $args = array() ) {
		$refused = self::refuse_start();
		if ( $refused ) {
			return $refused;
		}

		$dry_run = self::get_run( self::MODE_DRY_RUN );
		if ( ! $dry_run || self::STATUS_COMPLETE !== $dry_run['status'] ) {
			return new \WP_Error( 'dry_run_required', 'Run a dry run and review it before starting the backfill.' );
		}
		if ( self::cutoffs() !== $dry_run['cutoffs'] ) {
			return new \WP_Error( 'dry_run_stale', 'The dry run covered different records. Run it again before starting the backfill.' );
		}
		if ( empty( $args['backup_confirmed'] ) ) {
			return new \WP_Error( 'backup_required', 'Confirm that a database backup was taken before starting the backfill.' );
		}

		$run                        = self::new_run( self::MODE_BACKFILL );
		$run['started_by']          = (int) ( $args['user_id'] ?? get_current_user_id() );
		$run['backup_confirmed_at'] = gmdate( 'Y-m-d H:i:s' );
		self::save_run( self::MODE_BACKFILL, $run );
		self::schedule();
		return $run;
	}

	/**
	 * Continue a paused backfill once nothing blocks it.
	 *
	 * @return array|\WP_Error The run.
	 */
	public static function resume() {
		$run = self::get_run( self::MODE_BACKFILL );
		if ( ! $run || self::STATUS_PAUSED !== $run['status'] ) {
			return new \WP_Error( 'backfill_not_paused', 'The backfill is not paused.' );
		}
		$blockers = PaymentHistoryCompatibility::backfill_blockers();
		if ( $blockers ) {
			return new \WP_Error( 'backfill_blocked', 'The backfill can\'t continue yet.', array( 'blockers' => $blockers ) );
		}

		$run['status']   = self::STATUS_RUNNING;
		$run['blockers'] = array();
		self::save_run( self::MODE_BACKFILL, $run );
		self::schedule();
		return $run;
	}

	/**
	 * Verify a finished backfill again, e.g. after outstanding shadow work
	 * cleared.
	 *
	 * @return array|\WP_Error The run.
	 */
	public static function verify() {
		$run = self::get_run( self::MODE_BACKFILL );
		if ( ! $run || ! in_array( $run['status'], array( self::STATUS_VERIFIED, self::STATUS_VERIFICATION_FAILED ), true ) ) {
			return new \WP_Error( 'backfill_not_finished', 'The backfill has not finished.' );
		}

		$run['status'] = self::STATUS_RUNNING;
		$run['phase']  = 'verify';
		$run['cursor'] = 0;
		self::save_run( self::MODE_BACKFILL, $run );
		self::schedule();
		return $run;
	}

	/**
	 * Cron: run one batch, then queue the next while a run is running.
	 *
	 * @return void
	 */
	public static function run_scheduled() {
		$run = self::run_batch();
		if ( $run && self::STATUS_RUNNING === $run['status'] ) {
			$delay = empty( $run['failures'] ) ? 0 : min( HOUR_IN_SECONDS, MINUTE_IN_SECONDS * (int) $run['failures'] );
			wp_schedule_single_event( time() + $delay, self::CRON_HOOK );
		}
	}

	/**
	 * Keep a running run scheduled, and continue a paused backfill once its
	 * blockers cleared. Runs with the shadow work cron.
	 *
	 * @return void
	 */
	public static function ensure_scheduled() {
		$backfill = self::get_run( self::MODE_BACKFILL );
		if ( $backfill && self::STATUS_PAUSED === $backfill['status'] && ! PaymentHistoryCompatibility::backfill_blockers() ) {
			self::resume();
			return;
		}

		$dry_run = self::get_run( self::MODE_DRY_RUN );
		if ( ( $backfill && self::STATUS_RUNNING === $backfill['status'] ) || ( $dry_run && self::STATUS_RUNNING === $dry_run['status'] ) ) {
			self::schedule();
		}
	}

	/**
	 * Run one batch of whichever run is running, the backfill first.
	 * Batches never overlap: one that can't take the lock does nothing.
	 *
	 * @param int|null $batch_size Records per batch; defaults to the filtered BATCH_SIZE.
	 * @return array|null The run that advanced, or null when none is running or another batch holds the lock.
	 */
	public static function run_batch( ?int $batch_size = null ) {
		global $wpdb;

		$lock = substr( $wpdb->prefix . 'fair_events_payment_history_backfill', 0, 64 );
		if ( '1' !== (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 0)', $lock ) ) ) {
			return null;
		}

		try {
			foreach ( array( self::MODE_BACKFILL, self::MODE_DRY_RUN ) as $mode ) {
				$run = self::get_run( $mode );
				if ( $run && self::STATUS_RUNNING === $run['status'] ) {
					return self::step( $mode, $run, $batch_size );
				}
			}
			return null;
		} finally {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock ) );
		}
	}

	/**
	 * Run batches until no run is running or the limit is reached.
	 *
	 * @param int      $max_batches Most batches.
	 * @param int|null $batch_size  Records per batch.
	 * @return array|null The last run that advanced.
	 */
	public static function run_until_idle( $max_batches = 1000, ?int $batch_size = null ) {
		$last = null;
		for ( $i = 0; $i < $max_batches; $i++ ) {
			$run = self::run_batch( $batch_size );
			if ( ! $run ) {
				break;
			}
			$last = $run;
			if ( self::STATUS_RUNNING !== $run['status'] || ! empty( $run['last_error'] ) ) {
				break;
			}
		}
		return $last;
	}

	/**
	 * The cutoffs: the shadow writes' coverage floors.
	 *
	 * @return array{transaction_id: int, relationship_id: int}|null Null while shadow writes are off.
	 */
	public static function cutoffs() {
		$coverage = PaymentHistoryShadowWrites::coverage();
		if ( ! $coverage ) {
			return null;
		}
		return array(
			'transaction_id'  => (int) $coverage['transaction_floor'],
			'relationship_id' => (int) $coverage['relationship_floor'],
		);
	}

	/**
	 * A run's state.
	 *
	 * @param string $mode Mode.
	 * @return array|null
	 */
	public static function get_run( $mode ) {
		$state = PaymentHistoryCompatibility::get_state();
		return is_array( $state[ $mode ] ?? null ) ? $state[ $mode ] : null;
	}

	/**
	 * Why a run can't start now, if anything stops it.
	 *
	 * @return \WP_Error|null
	 */
	private static function refuse_start() {
		$blockers = PaymentHistoryCompatibility::backfill_blockers();
		if ( $blockers ) {
			return new \WP_Error( 'backfill_blocked', 'The payment history migration can\'t start on this site yet.', array( 'blockers' => $blockers ) );
		}
		$backfill = self::get_run( self::MODE_BACKFILL );
		if ( $backfill && in_array( $backfill['status'], array( self::STATUS_RUNNING, self::STATUS_PAUSED ), true ) ) {
			return new \WP_Error( 'backfill_running', 'The backfill is already running.' );
		}
		return null;
	}

	/**
	 * A fresh run.
	 *
	 * @param string $mode Mode.
	 * @return array
	 */
	private static function new_run( $mode ) {
		$now = gmdate( 'Y-m-d H:i:s' );
		return array(
			'status'       => self::STATUS_RUNNING,
			'phase'        => self::PHASES[ $mode ][0],
			'cursor'       => 0,
			'cutoffs'      => self::cutoffs(),
			'counts'       => array(),
			'totals'       => array(),
			'failures'     => 0,
			'last_error'   => null,
			'blockers'     => array(),
			'verification' => null,
			'started_at'   => $now,
			'updated_at'   => $now,
			'completed_at' => null,
		);
	}

	/**
	 * Save a run into the shared state option, re-read first so the shadow
	 * writes' coverage and the other run are kept. The backfill's status is
	 * also the migration's status (PaymentHistoryCompatibility::migration_verified()).
	 *
	 * @param string $mode Mode.
	 * @param array  $run  Run.
	 * @return array The run.
	 */
	private static function save_run( $mode, array $run ) {
		$run['updated_at'] = gmdate( 'Y-m-d H:i:s' );

		$state          = PaymentHistoryCompatibility::get_state();
		$state[ $mode ] = $run;
		if ( self::MODE_BACKFILL === $mode ) {
			$state['status'] = $run['status'];
		}
		update_option( PaymentHistoryCompatibility::STATE_OPTION, $state, false );
		return $run;
	}

	/**
	 * Queue the next batch.
	 *
	 * @return void
	 */
	private static function schedule() {
		if ( function_exists( 'wp_next_scheduled' ) && ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_single_event( time(), self::CRON_HOOK );
		}
	}

	/**
	 * Run one batch of a run's current phase and record the outcome. A
	 * failure keeps the cursor at the last record that succeeded, so the
	 * next batch retries from there.
	 *
	 * @param string   $mode       Mode.
	 * @param array    $run        Run.
	 * @param int|null $batch_size Records per batch.
	 * @return array The run.
	 */
	private static function step( $mode, array $run, ?int $batch_size ) {
		if ( self::MODE_BACKFILL === $mode ) {
			$blockers = PaymentHistoryCompatibility::backfill_blockers();
			if ( $blockers ) {
				$run['status']   = self::STATUS_PAUSED;
				$run['blockers'] = $blockers;
				return self::save_run( $mode, $run );
			}
		}

		$size   = max( 1, (int) ( $batch_size ?? apply_filters( 'fair_events_payment_history_backfill_batch_size', self::BATCH_SIZE ) ) );
		$phase  = (string) $run['phase'];
		$method = 'phase_' . $phase;

		try {
			$result = self::$method( $mode, $run, 'verify' === $phase ? min( $size, self::VERIFY_BATCH_SIZE ) : $size );
		} catch ( \Throwable $error ) {
			$result = array(
				'cursor' => (int) $run['cursor'],
				'done'   => false,
				'error'  => new \WP_Error( 'backfill_exception', $error->getMessage() ),
			);
		}

		$run['cursor'] = (int) $result['cursor'];
		if ( ! empty( $result['error'] ) ) {
			$run['failures']   = (int) $run['failures'] + 1;
			$run['last_error'] = array(
				'code'    => $result['error']->get_error_code(),
				'message' => $result['error']->get_error_message(),
				'data'    => $result['error']->get_error_data(),
				'phase'   => $phase,
				'cursor'  => (int) $run['cursor'],
				'at'      => gmdate( 'Y-m-d H:i:s' ),
			);
			return self::save_run( $mode, $run );
		}

		$run['failures']   = 0;
		$run['last_error'] = null;
		if ( $result['done'] ) {
			$next = array_search( $phase, self::PHASES[ $mode ], true ) + 1;
			if ( isset( self::PHASES[ $mode ][ $next ] ) ) {
				$run['phase']  = self::PHASES[ $mode ][ $next ];
				$run['cursor'] = 0;
			} else {
				$run = self::finish( $mode, $run );
			}
		}
		return self::save_run( $mode, $run );
	}

	/**
	 * Close a run after its last phase.
	 *
	 * @param string $mode Mode.
	 * @param array  $run  Run.
	 * @return array
	 */
	private static function finish( $mode, array $run ) {
		$run['completed_at'] = gmdate( 'Y-m-d H:i:s' );
		if ( self::MODE_DRY_RUN === $mode ) {
			$run['status'] = self::STATUS_COMPLETE;
			return $run;
		}

		$blockers            = PaymentHistoryVerification::global_checks( (int) $run['cutoffs']['transaction_id'] );
		$run['verification'] = array(
			'checked_at'  => gmdate( 'Y-m-d H:i:s' ),
			'blockers'    => $blockers,
			'comparisons' => PaymentHistoryVerification::summary(),
		);
		$run['status']       = $blockers ? self::STATUS_VERIFICATION_FAILED : self::STATUS_VERIFIED;
		return $run;
	}

	/**
	 * Add to a run's counts.
	 *
	 * @param array  $run   Run.
	 * @param string $key   Count.
	 * @param int    $count Amount.
	 * @return void
	 */
	private static function count( array &$run, $key, $count = 1 ) {
		if ( $count ) {
			$run['counts'][ $key ] = (int) ( $run['counts'][ $key ] ?? 0 ) + (int) $count;
		}
	}

	/**
	 * Phase 1: relationships up to the cutoff, in ID order.
	 *
	 * @param string $mode Mode.
	 * @param array  $run  Run.
	 * @param int    $size Batch size.
	 * @return array{cursor: int, done: bool, error: \WP_Error|null}
	 */
	private static function phase_admissions( $mode, array &$run, $size ) {
		global $wpdb;

		if ( ! ShadowPurchases::audience_tables_exist() ) {
			return self::done( $run );
		}

		$ids = array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					'SELECT id FROM %i WHERE id > %d AND id <= %d ORDER BY id ASC LIMIT %d',
					$wpdb->prefix . 'fair_audience_event_participants',
					(int) $run['cursor'],
					(int) $run['cutoffs']['relationship_id'],
					$size
				)
			)
		);

		return self::each( $run, $ids, $size, static fn( $id ) => self::process_relationship( $mode, $id, $run ) );
	}

	/**
	 * Phase 2: relationships with participant-scope activities.
	 *
	 * @param string $mode Mode.
	 * @param array  $run  Run.
	 * @param int    $size Batch size.
	 * @return array
	 */
	private static function phase_activities( $mode, array &$run, $size ) {
		global $wpdb;

		if ( ! ShadowPurchases::audience_tables_exist() ) {
			return self::done( $run );
		}

		$ids = array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					'SELECT DISTINCT event_participant_id FROM %i WHERE ticket_id IS NULL AND event_participant_id > %d AND event_participant_id <= %d ORDER BY event_participant_id ASC LIMIT %d',
					$wpdb->prefix . 'fair_audience_event_participant_options',
					(int) $run['cursor'],
					(int) $run['cutoffs']['relationship_id'],
					$size
				)
			)
		);

		return self::each( $run, $ids, $size, static fn( $id ) => self::process_activities( $mode, $id, $run ) );
	}

	/**
	 * Phase 3: Connector transactions up to the cutoff.
	 *
	 * @param string $mode Mode.
	 * @param array  $run  Run.
	 * @param int    $size Batch size.
	 * @return array
	 */
	private static function phase_transactions( $mode, array &$run, $size ) {
		global $wpdb;

		$ids = array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					'SELECT id FROM %i WHERE id > %d AND id <= %d ORDER BY id ASC LIMIT %d',
					\FairPaymentsConnector\Database\Schema::get_payments_table_name(),
					(int) $run['cursor'],
					(int) $run['cutoffs']['transaction_id'],
					$size
				)
			)
		);

		return self::each(
			$run,
			$ids,
			$size,
			static function ( $id ) use ( $mode, &$run ) {
				return self::process_transaction( $mode, $id, $run );
			}
		);
	}

	/**
	 * Phase 4: Audience ledger rows: refund-labelled ones and those naming
	 * deleted transactions.
	 *
	 * @param string $mode Mode.
	 * @param array  $run  Run.
	 * @param int    $size Batch size.
	 * @return array
	 */
	private static function phase_references( $mode, array &$run, $size ) {
		global $wpdb;

		if ( ! ShadowPurchases::audience_tables_exist() ) {
			return self::done( $run );
		}

		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT l.id, l.event_participant_id, l.transaction_id, l.kind, ep.event_date_id, ep.participant_id, t.id AS existing_transaction_id
				FROM %i AS l
				LEFT JOIN %i AS ep ON ep.id = l.event_participant_id
				LEFT JOIN %i AS t ON t.id = l.transaction_id
				WHERE l.id > %d AND l.transaction_id <= %d ORDER BY l.id ASC LIMIT %d',
				$wpdb->prefix . 'fair_audience_event_participant_transactions',
				$wpdb->prefix . 'fair_audience_event_participants',
				\FairPaymentsConnector\Database\Schema::get_payments_table_name(),
				(int) $run['cursor'],
				(int) $run['cutoffs']['transaction_id'],
				$size
			),
			ARRAY_A
		);

		$by_id = array();
		foreach ( $rows as $row ) {
			$by_id[ (int) $row['id'] ] = $row;
		}

		return self::each( $run, array_keys( $by_id ), $size, static fn( $id ) => self::process_ledger_row( $mode, $by_id[ $id ], $run ) );
	}

	/**
	 * Phase 5: purchases whose latest attempt names a deleted transaction.
	 *
	 * @param string $mode Mode.
	 * @param array  $run  Run.
	 * @param int    $size Batch size.
	 * @return array
	 */
	private static function phase_signup_references( $mode, array &$run, $size ) {
		global $wpdb;

		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT s.id, s.transaction_id, s.event_date_id, t.id AS existing_transaction_id FROM %i AS s
				LEFT JOIN %i AS t ON t.id = s.transaction_id
				WHERE s.id > %d AND s.transaction_id IS NOT NULL AND s.transaction_id <= %d ORDER BY s.id ASC LIMIT %d',
				$wpdb->prefix . 'fair_events_signups',
				\FairPaymentsConnector\Database\Schema::get_payments_table_name(),
				(int) $run['cursor'],
				(int) $run['cutoffs']['transaction_id'],
				$size
			),
			ARRAY_A
		);

		$by_id = array();
		foreach ( $rows as $row ) {
			$by_id[ (int) $row['id'] ] = $row;
		}

		return self::each(
			$run,
			array_keys( $by_id ),
			$size,
			static function ( $id ) use ( $mode, $by_id ) {
				$row = $by_id[ $id ];
				if ( $row['existing_transaction_id'] ) {
					return 'signup_reference_ok';
				}
				PaymentHistoryFinding::record( $mode, 'missing_transaction', PaymentHistoryFinding::SOURCE_SIGNUP, $id, (int) $row['event_date_id'], array( 'transaction_id' => (int) $row['transaction_id'] ) );
				return 'signup_missing_transaction';
			}
		);
	}

	/**
	 * Phase 6 (backfill): signed-up relationships up to the cutoff that have
	 * no purchase yet, including those that were pending earlier (§4.1, §8.3).
	 *
	 * @param string $mode Mode.
	 * @param array  $run  Run.
	 * @param int    $size Batch size.
	 * @return array
	 */
	private static function phase_revisit_admissions( $mode, array &$run, $size ) {
		global $wpdb;

		if ( ! ShadowPurchases::audience_tables_exist() ) {
			return self::done( $run );
		}

		$ids = array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT ep.id FROM %i AS ep WHERE ep.id > %d AND ep.id <= %d AND ep.label = 'signed_up'
					AND NOT EXISTS ( SELECT 1 FROM %i AS bp WHERE bp.legacy_event_participant_id = ep.id )
					ORDER BY ep.id ASC LIMIT %d",
					$wpdb->prefix . 'fair_audience_event_participants',
					(int) $run['cursor'],
					(int) $run['cutoffs']['relationship_id'],
					$wpdb->prefix . 'fair_events_signups',
					$size
				)
			)
		);

		return self::each( $run, $ids, $size, static fn( $id ) => self::revisited( self::process_relationship( $mode, $id, $run ) ) );
	}

	/**
	 * Phase 7 (backfill): open findings the evidence may resolve now.
	 *
	 * @param string $mode Mode.
	 * @param array  $run  Run.
	 * @param int    $size Batch size.
	 * @return array
	 */
	private static function phase_revisit_findings( $mode, array &$run, $size ) {
		global $wpdb;

		$reasons = self::REVISIT_TRANSACTION_REASONS;
		$rows    = (array) $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- generated %s list.
				'SELECT id, source_type, source_id FROM %i WHERE mode = %s AND status = %s AND id > %d
				AND ( ( source_type = %s AND reason IN ( ' . implode( ', ', array_fill( 0, count( $reasons ), '%s' ) ) . ' ) ) OR ( source_type = %s AND reason = %s ) )
				ORDER BY id ASC LIMIT %d',
				array_merge(
					array( PaymentHistoryFinding::table(), $mode, PaymentHistoryFinding::STATUS_OPEN, (int) $run['cursor'], PaymentHistoryFinding::SOURCE_TRANSACTION ),
					$reasons,
					array( PaymentHistoryFinding::SOURCE_RELATIONSHIP, 'ambiguous_activity', $size )
				)
			),
			ARRAY_A
		);

		$by_id = array();
		foreach ( $rows as $row ) {
			$by_id[ (int) $row['id'] ] = $row;
		}

		return self::each(
			$run,
			array_keys( $by_id ),
			$size,
			static function ( $id ) use ( $mode, $by_id, &$run ) {
				$row = $by_id[ $id ];
				return self::revisited(
					PaymentHistoryFinding::SOURCE_TRANSACTION === $row['source_type']
						? self::process_transaction( $mode, (int) $row['source_id'], $run )
						: self::process_activities( $mode, (int) $row['source_id'], $run )
				);
			}
		);
	}

	/**
	 * Phase 8 (backfill): compare every event date (§8.4).
	 *
	 * @param string $mode Mode.
	 * @param array  $run  Run.
	 * @param int    $size Batch size.
	 * @return array
	 */
	private static function phase_verify( $mode, array &$run, $size ) {
		global $wpdb;

		unset( $mode );
		if ( 0 === (int) $run['cursor'] ) {
			PaymentHistoryVerification::clear();
		}

		$ids = array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare( 'SELECT id FROM %i WHERE id > %d ORDER BY id ASC LIMIT %d', $wpdb->prefix . 'fair_event_dates', (int) $run['cursor'], $size )
			)
		);

		return self::each(
			$run,
			$ids,
			$size,
			static function ( $id ) {
				$comparison = PaymentHistoryVerification::check_event_date( $id );
				if ( ! $comparison ) {
					return 'verify_no_history';
				}
				return $comparison['blocking'] ? 'verify_blocking' : 'verify_clean';
			}
		);
	}

	/**
	 * Final dry-run phase: nothing to process; the run completes.
	 *
	 * @param string $mode Mode.
	 * @param array  $run  Run.
	 * @param int    $size Batch size.
	 * @return array
	 */
	private static function phase_summary( $mode, array &$run, $size ) {
		unset( $mode, $size );
		return self::done( $run );
	}

	/**
	 * A revisit's outcome, told apart from the first pass's in the counts.
	 *
	 * @param string|\WP_Error $outcome Outcome.
	 * @return string|\WP_Error
	 */
	private static function revisited( $outcome ) {
		return is_wp_error( $outcome ) ? $outcome : 'revisit_' . $outcome;
	}

	/**
	 * Result of a phase with nothing (more) to do.
	 *
	 * @param array $run Run.
	 * @return array
	 */
	private static function done( array $run ) {
		return array(
			'cursor' => (int) $run['cursor'],
			'done'   => true,
			'error'  => null,
		);
	}

	/**
	 * Process records in order, counting each outcome; stop at the first
	 * failure without passing it.
	 *
	 * @param array    $run     Run.
	 * @param int[]    $ids     Record IDs, ascending.
	 * @param int      $size    Batch size.
	 * @param callable $process Returns an outcome string or a WP_Error.
	 * @return array{cursor: int, done: bool, error: \WP_Error|null}
	 */
	private static function each( array &$run, array $ids, $size, callable $process ) {
		$cursor = (int) $run['cursor'];
		foreach ( $ids as $id ) {
			$outcome = $process( (int) $id );
			if ( is_wp_error( $outcome ) ) {
				return array(
					'cursor' => $cursor,
					'done'   => false,
					'error'  => $outcome,
				);
			}
			self::count( $run, (string) $outcome );
			$cursor = (int) $id;
		}

		return array(
			'cursor' => $cursor,
			'done'   => count( $ids ) < $size,
			'error'  => null,
		);
	}

	/**
	 * Decide on one relationship, creating its purchase when it is a legacy
	 * admission (§4.1–4.3).
	 *
	 * @param string $mode            Mode.
	 * @param int    $relationship_id Relationship ID.
	 * @param array  $run             Run.
	 * @return string|\WP_Error Outcome.
	 */
	private static function process_relationship( $mode, $relationship_id, array $run ) {
		$relationship = ShadowPurchases::relationship( $relationship_id );
		if ( ! $relationship ) {
			return 'relationship_missing';
		}

		switch ( PaymentHistoryAdmissions::classify( $relationship ) ) {
			case PaymentHistoryAdmissions::EXISTING_PURCHASE:
				return 'relationship_has_purchase';
			case PaymentHistoryAdmissions::PENDING:
				return 'relationship_pending';
			case PaymentHistoryAdmissions::NOT_ADMISSION:
				return 'relationship_not_admission';
			case PaymentHistoryAdmissions::DUPLICATE_SERIES:
				PaymentHistoryFinding::record(
					$mode,
					'duplicate_series_relationship',
					PaymentHistoryFinding::SOURCE_RELATIONSHIP,
					$relationship_id,
					(int) $relationship->event_date_id,
					array( 'participant_id' => (int) $relationship->participant_id )
				);
				return 'duplicate_series_relationship';
		}

		if ( self::MODE_DRY_RUN === $mode ) {
			return 'purchase_planned';
		}
		return self::create_purchase( $relationship_id, (int) $run['cutoffs']['transaction_id'] );
	}

	/**
	 * Create a legacy admission's purchase, unit, activities and check-in,
	 * and link the attempts its ledger names that are attributable now, in
	 * one database transaction (§8.3). Locks: the relationship first, then
	 * each transaction in ascending ID order, as no other writer holds both.
	 *
	 * @param int $relationship_id    Relationship ID.
	 * @param int $transaction_cutoff Highest transaction ID the backfill covers.
	 * @return string|\WP_Error Outcome.
	 */
	private static function create_purchase( $relationship_id, $transaction_cutoff ) {
		global $wpdb;

		$transaction_ids = array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT DISTINCT transaction_id FROM %i WHERE event_participant_id = %d AND kind = 'charge' AND transaction_id <= %d ORDER BY transaction_id ASC",
					$wpdb->prefix . 'fair_audience_event_participant_transactions',
					(int) $relationship_id,
					(int) $transaction_cutoff
				)
			)
		);

		if ( ! ShadowPurchases::acquire_lock( $relationship_id ) ) {
			return new \WP_Error( 'shadow_purchase_busy', 'Another writer is creating this relationship\'s purchase.', array( 'event_participant_id' => (int) $relationship_id ) );
		}
		$held = array();
		try {
			foreach ( $transaction_ids as $transaction_id ) {
				if ( ! PaymentLinks::acquire_lock( $transaction_id ) ) {
					return new \WP_Error( 'payment_links_busy', 'Another writer is recording links for this transaction.', array( 'transaction_id' => $transaction_id ) );
				}
				$held[] = $transaction_id;
			}

			$wpdb->query( 'START TRANSACTION' );
			$result = self::create_purchase_locked( $relationship_id, $transaction_ids );
			if ( is_wp_error( $result ) ) {
				$wpdb->query( 'ROLLBACK' );
			} else {
				$wpdb->query( 'COMMIT' );
			}
			return $result;
		} finally {
			foreach ( array_reverse( $held ) as $transaction_id ) {
				PaymentLinks::release_lock( $transaction_id );
			}
			ShadowPurchases::release_lock( $relationship_id );
		}
	}

	/**
	 * Body of create_purchase(), inside its locks and database transaction.
	 *
	 * @param int   $relationship_id Relationship ID.
	 * @param int[] $transaction_ids Ledger charge transactions, ascending.
	 * @return string|\WP_Error Outcome.
	 */
	private static function create_purchase_locked( $relationship_id, array $transaction_ids ) {
		global $wpdb;

		// Decide again under the lock: a live writer may have got here first.
		$relationship = ShadowPurchases::relationship( $relationship_id );
		if ( ! $relationship ) {
			return 'relationship_missing';
		}
		if ( PaymentHistoryAdmissions::ADMISSION !== PaymentHistoryAdmissions::classify( $relationship ) ) {
			return 'relationship_changed';
		}

		$signup_id = ShadowPurchases::create_purchase( $relationship );
		if ( is_wp_error( $signup_id ) ) {
			return $signup_id;
		}

		$units = EventTicket::get_by_signup_id( (int) $signup_id );
		if ( ! $units ) {
			return new \WP_Error( 'backfill_write_failed', 'The backfilled purchase has no ticket.', array( 'event_participant_id' => (int) $relationship_id ) );
		}
		$copied = self::copy_activities( $relationship_id, (int) $units[0]->id );
		if ( is_wp_error( $copied ) ) {
			return $copied;
		}

		$history = $wpdb->get_row(
			$wpdb->prepare( 'SELECT attended_at, attended_ticket_id FROM %i WHERE id = %d', $wpdb->prefix . 'fair_audience_event_participants', (int) $relationship_id )
		);
		// Unless TicketHistoryBackfill already put the check-in on a ticket (§4.2).
		if ( $history && ! empty( $history->attended_at ) && empty( $history->attended_ticket_id ) ) {
			EventTicket::set_attended( (int) $units[0]->id, true, (string) $history->attended_at );
		}

		$attribution = new PaymentAttribution( new PaymentAttributionDatabase() );
		foreach ( $transaction_ids as $transaction_id ) {
			$transaction = PaymentAttributionDatabase::transaction( $transaction_id );
			if ( ! $transaction ) {
				continue;
			}
			$result = $attribution->attribute( $transaction );
			if ( 'attributed' !== $result['outcome'] ) {
				continue;
			}
			$written = PaymentLinks::write_in_transaction( $transaction_id, self::backfill_links( $result['links'] ) );
			// A decision about the evidence wrote nothing; the transactions
			// phase reports it. Anything else undoes the whole purchase.
			if ( is_wp_error( $written ) && ! in_array( $written->get_error_code(), self::LINK_DECISION_ERRORS, true ) && 'missing_transaction' !== $written->get_error_code() ) {
				return $written;
			}
		}

		ShadowPurchases::refresh_amount( (int) $signup_id );
		return 'purchase_created';
	}

	/**
	 * Copy a relationship's participant-scope activities onto a unit,
	 * keeping their status and hold, never overwriting what the unit has.
	 *
	 * @param int $relationship_id Relationship ID.
	 * @param int $ticket_id       Ticket ID.
	 * @return int|\WP_Error Activities added.
	 */
	private static function copy_activities( $relationship_id, $ticket_id ) {
		global $wpdb;

		$added = 0;
		foreach ( self::participant_scope_options( $relationship_id ) as $option ) {
			EventTicketActivity::insert_missing( (int) $ticket_id, (int) $option->ticket_option_id, (string) $option->ticket_option_name, (string) $option->status, $option->expires_at );
			if ( $wpdb->last_error ) {
				return new \WP_Error( 'backfill_write_failed', 'An activity could not be copied to the backfilled ticket.', array( 'ticket_id' => (int) $ticket_id ) );
			}
			$added += (int) $wpdb->rows_affected;
		}
		return $added;
	}

	/**
	 * A relationship's participant-scope activities.
	 *
	 * @param int $relationship_id Relationship ID.
	 * @return object[]
	 */
	private static function participant_scope_options( $relationship_id ) {
		global $wpdb;

		return (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT ticket_option_id, ticket_option_name, status, expires_at FROM %i WHERE event_participant_id = %d AND ticket_id IS NULL ORDER BY id ASC',
				$wpdb->prefix . 'fair_audience_event_participant_options',
				(int) $relationship_id
			)
		);
	}

	/**
	 * Attribute a relationship's participant-scope activities to its one
	 * candidate ticket (§4.4): its purchase's unit when a purchase names it
	 * as provenance. Without such a purchase they stay at participant
	 * scope, where Statistics and capacity keep counting them; with zero or
	 * several tickets held there that's `ambiguous_activity` (§8.9).
	 *
	 * @param string $mode            Mode.
	 * @param int    $relationship_id Relationship ID.
	 * @param array  $run             Run.
	 * @return string|\WP_Error Outcome.
	 */
	private static function process_activities( $mode, $relationship_id, array $run ) {
		$relationship = ShadowPurchases::relationship( $relationship_id );
		if ( ! $relationship ) {
			return 'activities_relationship_missing';
		}
		$options = self::participant_scope_options( $relationship_id );
		if ( ! $options ) {
			PaymentHistoryFinding::resolve_source( $mode, PaymentHistoryFinding::SOURCE_RELATIONSHIP, $relationship_id, array( 'duplicate_series_relationship' ) );
			return 'activities_none';
		}

		$signup  = ShadowPurchases::purchase_for( $relationship_id );
		$planned = ! $signup && self::MODE_DRY_RUN === $mode
			&& ( new PaymentHistoryAdmissions( (int) $run['cutoffs']['relationship_id'] ) )->planned_relationship( $relationship_id );

		if ( $signup || $planned ) {
			PaymentHistoryFinding::resolve_source( $mode, PaymentHistoryFinding::SOURCE_RELATIONSHIP, $relationship_id, array( 'duplicate_series_relationship' ) );
			if ( ! $signup ) {
				return 'activities_planned';
			}
			if ( self::MODE_DRY_RUN === $mode ) {
				return 'activities_on_existing_purchase';
			}

			$units = EventTicket::get_by_signup_id( (int) $signup->id );
			if ( ! $units ) {
				return new \WP_Error( 'backfill_write_failed', 'The purchase has no ticket to carry its activities.', array( 'signup_id' => (int) $signup->id ) );
			}
			$added = self::copy_activities( $relationship_id, (int) $units[0]->id );
			if ( is_wp_error( $added ) ) {
				return $added;
			}
			return $added ? 'activities_copied' : 'activities_already_copied';
		}

		if ( 'signed_up' !== $relationship->label ) {
			return 'activities_not_admission';
		}

		$candidates = EventTicket::get_held_on_event_date( (int) $relationship->event_date_id, (int) $relationship->participant_id );
		if ( 1 === count( $candidates ) ) {
			// Statistics already gives these to the one ticket; copying
			// without marking the source row would count them twice.
			PaymentHistoryFinding::resolve_source( $mode, PaymentHistoryFinding::SOURCE_RELATIONSHIP, $relationship_id, array( 'duplicate_series_relationship' ) );
			return 'activities_single_ticket';
		}

		PaymentHistoryFinding::record(
			$mode,
			'ambiguous_activity',
			PaymentHistoryFinding::SOURCE_RELATIONSHIP,
			$relationship_id,
			(int) $relationship->event_date_id,
			array(
				'participant_id'    => (int) $relationship->participant_id,
				'ticket_option_ids' => array_map( 'intval', array_column( $options, 'ticket_option_id' ) ),
				'candidate_tickets' => array_map( 'intval', array_column( $candidates, 'id' ) ),
			)
		);
		return 'activities_ambiguous';
	}

	/**
	 * Attribute and link one transaction, or report why not.
	 *
	 * @param string $mode           Mode.
	 * @param int    $transaction_id Transaction ID.
	 * @param array  $run            Run; dry-run totals are added to it.
	 * @return string|\WP_Error Outcome.
	 */
	private static function process_transaction( $mode, $transaction_id, array &$run ) {
		$transaction = PaymentAttributionDatabase::transaction( $transaction_id );
		if ( ! $transaction ) {
			return PaymentHistoryCompatibility::payment_information_available()
				? 'transaction_missing'
				: new \WP_Error( 'payment_information_unavailable', 'Payment information can\'t be read.' );
		}

		$sources = new PaymentAttributionDatabase();
		if ( self::MODE_DRY_RUN === $mode ) {
			$sources = new PaymentHistoryPlannedSources( $sources, new PaymentHistoryAdmissions( (int) $run['cutoffs']['relationship_id'] ) );
		}
		$result = ( new PaymentAttribution( $sources ) )->attribute( $transaction );

		$type          = PaymentHistoryFinding::SOURCE_TRANSACTION;
		$event_date_id = (int) ( $transaction['metadata']['event_date_id'] ?? 0 );
		$summary       = array(
			'amount'   => \FairEventsShared\LineItemTotals::normalize_amount( $transaction['amount'] ),
			'currency' => strtoupper( $transaction['currency'] ),
			'status'   => $transaction['status'],
			'source'   => (string) ( $transaction['metadata']['source'] ?? '' ),
		);

		if ( 'out_of_scope' === $result['outcome'] ) {
			PaymentHistoryFinding::resolve_source( $mode, $type, $transaction_id );
			return 'transaction_out_of_scope';
		}

		if ( 'unresolved' === $result['outcome'] ) {
			PaymentHistoryFinding::record( $mode, (string) $result['reason'], $type, $transaction_id, $event_date_id, $summary + array( 'evidence' => $result['detail'] ) );
			PaymentHistoryFinding::resolve_source( $mode, $type, $transaction_id, array( (string) $result['reason'], 'currency_mismatch' ) );
			self::add_total( $run, $mode, $summary, 'unresolved' );
			return 'transaction_unresolved';
		}

		$keep = array( 'currency_mismatch' );
		foreach ( $result['notes'] as $note ) {
			// A backfilled or shadow purchase's amount comes from its links
			// (§4.2), so a difference there says nothing.
			if ( 'amount_mismatch' === $note['reason'] && self::amount_follows_links( (int) $note['detail']['signup_id'] ) ) {
				continue;
			}
			PaymentHistoryFinding::record( $mode, (string) $note['reason'], $type, $transaction_id, $event_date_id, $summary + $note['detail'] );
			$keep[] = (string) $note['reason'];
		}

		$links = self::backfill_links( $result['links'] );
		if ( self::MODE_DRY_RUN === $mode ) {
			$outcome = self::plan_links( $run, $transaction_id, $transaction, $links, $event_date_id, $summary );
		} else {
			$outcome = self::write_links( $run, $transaction_id, $links, $event_date_id, $summary );
		}
		if ( is_wp_error( $outcome ) ) {
			return $outcome;
		}

		if ( 'transaction_conflict' === $outcome ) {
			$keep[] = 'existing_link_conflict';
			self::add_total( $run, $mode, $summary, 'unresolved' );
		} else {
			self::add_total( $run, $mode, $summary, 'attributed' );
		}
		PaymentHistoryFinding::resolve_source( $mode, $type, $transaction_id, $keep );
		return $outcome;
	}

	/**
	 * Dry run: count the links the backfill would add, without writing.
	 *
	 * @param array $run            Run.
	 * @param int   $transaction_id Transaction ID.
	 * @param array $transaction    Transaction.
	 * @param array $links          Links.
	 * @param int   $event_date_id  Date from the metadata.
	 * @param array $summary        Transaction summary.
	 * @return string Outcome.
	 */
	private static function plan_links( array &$run, $transaction_id, array $transaction, array $links, $event_date_id, array $summary ) {
		foreach ( $links as $link ) {
			if ( PaymentHistoryPlannedSources::is_planned( $link['signup_id'] ) ) {
				self::count( $run, 'links_planned', count( $links ) );
				return 'transaction_attributed';
			}
		}

		$plan = PaymentLinkAllocation::prepare( $links, $transaction, SignupPaymentLink::get_by_transaction_id( $transaction_id ) );
		if ( is_wp_error( $plan ) ) {
			self::record_conflict( PaymentHistoryFinding::MODE_DRY_RUN, $transaction_id, $event_date_id, $summary, $plan, $links );
			return 'transaction_conflict';
		}
		self::count( $run, 'links_planned', count( $plan['insert'] ) );
		self::count( $run, 'links_unchanged', count( $plan['unchanged'] ) );
		return 'transaction_attributed';
	}

	/**
	 * Backfill: write the links. A refused set is reported, a failure retried.
	 *
	 * @param array $run            Run.
	 * @param int   $transaction_id Transaction ID.
	 * @param array $links          Links.
	 * @param int   $event_date_id  Date from the metadata.
	 * @param array $summary        Transaction summary.
	 * @return string|\WP_Error Outcome.
	 */
	private static function write_links( array &$run, $transaction_id, array $links, $event_date_id, array $summary ) {
		$written = PaymentLinks::write( $transaction_id, $links );
		if ( is_wp_error( $written ) ) {
			if ( 'missing_transaction' === $written->get_error_code() ) {
				PaymentHistoryFinding::record( self::MODE_BACKFILL, 'missing_transaction', PaymentHistoryFinding::SOURCE_TRANSACTION, $transaction_id, $event_date_id, $summary );
				return 'transaction_missing';
			}
			if ( in_array( $written->get_error_code(), self::LINK_DECISION_ERRORS, true ) ) {
				self::record_conflict( self::MODE_BACKFILL, $transaction_id, $event_date_id, $summary, $written, $links );
				return 'transaction_conflict';
			}
			return $written;
		}

		self::count( $run, 'links_inserted', (int) $written['inserted'] );
		self::count( $run, 'links_unchanged', (int) $written['unchanged'] );
		foreach ( array_unique( array_column( $links, 'signup_id' ) ) as $signup_id ) {
			ShadowPurchases::refresh_amount( (int) $signup_id );
		}
		return 'transaction_attributed';
	}

	/**
	 * Report links the evidence supports but the stored links refuse: a
	 * live or reconciled link that differs, or no room under the total.
	 * Stored links are never changed (§8.2).
	 *
	 * @param string    $mode           Mode.
	 * @param int       $transaction_id Transaction ID.
	 * @param int       $event_date_id  Date from the metadata.
	 * @param array     $summary        Transaction summary.
	 * @param \WP_Error $error          Refusal.
	 * @param array     $links          Proposed links.
	 * @return void
	 */
	private static function record_conflict( $mode, $transaction_id, $event_date_id, array $summary, \WP_Error $error, array $links ) {
		PaymentHistoryFinding::record(
			$mode,
			'existing_link_conflict',
			PaymentHistoryFinding::SOURCE_TRANSACTION,
			$transaction_id,
			$event_date_id,
			$summary + array(
				'error'    => $error->get_error_code(),
				'proposed' => array_map(
					static function ( $link ) {
						return array(
							'signup_id'        => (int) $link['signup_id'],
							'role'             => $link['role'],
							'allocated_amount' => $link['allocated_amount'],
						);
					},
					$links
				),
			)
		);
	}

	/**
	 * Keep one ledger row's history: a refund-labelled row becomes a
	 * `legacy_refund_record` link that never counts (§11), and a row naming
	 * a deleted transaction is reported (gap G8).
	 *
	 * @param string $mode Mode.
	 * @param array  $row  Ledger row with its relationship's date and participant.
	 * @param array  $run  Run.
	 * @return string|\WP_Error Outcome.
	 */
	private static function process_ledger_row( $mode, array $row, array $run ) {
		$ledger_id     = (int) $row['id'];
		$event_date_id = (int) $row['event_date_id'];
		$detail        = array(
			'transaction_id'       => (int) $row['transaction_id'],
			'event_participant_id' => (int) $row['event_participant_id'],
			'kind'                 => (string) $row['kind'],
		);

		if ( ! $row['existing_transaction_id'] ) {
			PaymentHistoryFinding::record( $mode, 'missing_transaction', PaymentHistoryFinding::SOURCE_LEDGER_ROW, $ledger_id, $event_date_id, $detail );
		}
		if ( 'refund' !== $row['kind'] ) {
			return $row['existing_transaction_id'] ? 'ledger_row_ok' : 'ledger_missing_transaction';
		}

		PaymentHistoryFinding::record( $mode, 'unsupported_refund_record', PaymentHistoryFinding::SOURCE_LEDGER_ROW, $ledger_id, $event_date_id, $detail );
		if ( ! $row['existing_transaction_id'] ) {
			return 'refund_record_missing_transaction';
		}

		$relationship_id = (int) $row['event_participant_id'];
		$sources         = new PaymentAttributionDatabase();
		if ( self::MODE_DRY_RUN === $mode ) {
			$sources = new PaymentHistoryPlannedSources( $sources, new PaymentHistoryAdmissions( (int) $run['cutoffs']['relationship_id'] ) );
		}
		$signup_id = $sources->purchase_for_relationship( $relationship_id );
		if ( ! $signup_id && $row['participant_id'] ) {
			$active    = $sources->active_purchases( $event_date_id, (int) $row['participant_id'] );
			$signup_id = 1 === count( $active ) ? (int) $active[0] : null;
		}
		if ( ! $signup_id ) {
			return 'refund_record_unlinked';
		}
		if ( self::MODE_DRY_RUN === $mode ) {
			return 'refund_record_planned';
		}

		$written = PaymentLinks::write(
			(int) $row['transaction_id'],
			array(
				array(
					'signup_id'        => (int) $signup_id,
					'role'             => SignupPaymentLink::ROLE_LEGACY_REFUND_RECORD,
					'allocated_amount' => 0,
					'attribution'      => SignupPaymentLink::ATTRIBUTION_BACKFILL,
					'evidence'         => array(
						'type'                 => 'ledger_refund_record',
						'ledger_row_id'        => $ledger_id,
						'event_participant_id' => $relationship_id,
						'signup_ids'           => array( (int) $signup_id ),
					),
				),
			)
		);
		if ( is_wp_error( $written ) ) {
			return in_array( $written->get_error_code(), self::LINK_DECISION_ERRORS, true ) || 'missing_transaction' === $written->get_error_code()
				? 'refund_record_conflict'
				: $written;
		}
		return 'refund_record_linked';
	}

	/**
	 * Attribution's links, marked as written by the backfill.
	 *
	 * @param array[] $links Links.
	 * @return array[]
	 */
	private static function backfill_links( array $links ) {
		return array_map(
			static function ( $link ) {
				return $link + array( 'attribution' => SignupPaymentLink::ATTRIBUTION_BACKFILL );
			},
			$links
		);
	}

	/**
	 * Whether a purchase's amount is derived from its links: a planned or
	 * provenance purchase.
	 *
	 * @param int $signup_id Signup ID.
	 * @return bool
	 */
	private static function amount_follows_links( $signup_id ) {
		global $wpdb;

		if ( PaymentHistoryPlannedSources::is_planned( $signup_id ) ) {
			return true;
		}
		return (bool) $wpdb->get_var(
			$wpdb->prepare( 'SELECT legacy_event_participant_id FROM %i WHERE id = %d', $wpdb->prefix . 'fair_events_signups', (int) $signup_id )
		);
	}

	/**
	 * Dry run: add a paid transaction to the attributed or unresolved total
	 * of its currency. The backfill reports its totals per event date
	 * instead (PaymentHistoryVerification).
	 *
	 * @param array  $run     Run.
	 * @param string $mode    Mode.
	 * @param array  $summary Transaction summary.
	 * @param string $bucket  attributed or unresolved.
	 * @return void
	 */
	private static function add_total( array &$run, $mode, array $summary, $bucket ) {
		if ( self::MODE_DRY_RUN !== $mode || 'paid' !== $summary['status'] ) {
			return;
		}
		$currency = $summary['currency'];

		$run['totals'][ $currency ]            = $run['totals'][ $currency ] ?? array(
			'attributed' => 0.0,
			'unresolved' => 0.0,
		);
		$run['totals'][ $currency ][ $bucket ] = \FairEventsShared\LineItemTotals::normalize_amount( $run['totals'][ $currency ][ $bucket ] + (float) $summary['amount'] );
	}
}
