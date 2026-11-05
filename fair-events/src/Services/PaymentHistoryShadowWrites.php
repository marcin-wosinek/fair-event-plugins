<?php
/**
 * Payment history shadow writes
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\PaymentShadowWork;
use FairEvents\Models\SignupPaymentLink;

defined( 'WPINC' ) || die;

/**
 * Records the payment history of every live payment writer in Events-owned
 * storage while the existing flows stay authoritative
 * (PAYMENT_HISTORY_MIGRATION.md §8.1, §8.8):
 *
 * - Every attempt Connector creates is queued when it is created and
 *   linked to its purchases with `attribution = live`, using the same rules
 *   as the historical backfill (PaymentAttribution). Failed attempts are
 *   linked too; a status change re-queues the transaction.
 * - Every Fair Audience relationship a payment names, and every one the
 *   periodic sweep finds out of step, gets its shadow purchase synced
 *   (ShadowPurchases), so Audience-only admissions have a purchase to link.
 *
 * Work is queued in fair_events_payment_shadow_work and done when the
 * request ends, after every writer of the request has finished: relationships
 * first, then transactions. Work that fails, or whose evidence names no
 * purchase yet, stays queued with its reason and is retried by cron with a
 * growing delay. Outstanding work blocks the migration's verification.
 *
 * Nothing here changes a ledger row, relationship, transaction or existing
 * Events purchase, and nothing fires a hook.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PaymentHistoryShadowWrites {

	/**
	 * Cron hook that retries due work and runs the sweep.
	 */
	const CRON_HOOK = 'fair_events_payment_history_shadow_work';

	/**
	 * Cron recurrence name.
	 */
	const CRON_SCHEDULE = 'fair_events_fifteen_minutes';

	/**
	 * Most queue rows processed per run.
	 */
	const BATCH_SIZE = 50;

	/**
	 * Work queued by this request, processed at shutdown.
	 *
	 * @var array<string, array<int, true>>
	 */
	private static $queued = array(
		PaymentShadowWork::KIND_RELATIONSHIP => array(),
		PaymentShadowWork::KIND_TRANSACTION  => array(),
	);

	/**
	 * Whether the shutdown processor is registered.
	 *
	 * @var bool
	 */
	private static $shutdown_registered = false;

	/**
	 * Register hooks and turn coverage on once the site supports it.
	 *
	 * @return void
	 */
	public static function init() {
		add_filter( 'cron_schedules', array( static::class, 'add_cron_schedule' ) );
		add_action( self::CRON_HOOK, array( static::class, 'run_scheduled' ) );
		add_action( 'init', array( static::class, 'maybe_enable' ), 20 );

		add_action( 'fair_payment_transaction_created', array( static::class, 'on_transaction_created' ), 100, 3 );
		add_action( 'fair_payment_status_changed', array( static::class, 'on_status_changed' ), 100, 2 );
		add_action( 'fair_audience_cleanup_expired_signups', array( static::class, 'sweep' ), 100 );
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
	 * Turn shadow writes on when the site supports them, recording the
	 * coverage floors: transactions and relationships up to these IDs are
	 * the historical backfill's; everything after is the live writers'.
	 * Schedules the retry cron while coverage is on.
	 *
	 * @return void
	 */
	public static function maybe_enable() {
		if ( ! PaymentHistoryCompatibility::shadow_writes_supported() ) {
			return;
		}

		if ( ! self::coverage() ) {
			$state                  = PaymentHistoryCompatibility::get_state();
			$state['shadow_writes'] = array(
				'enabled_at'         => gmdate( 'Y-m-d H:i:s' ),
				'transaction_floor'  => self::max_id( self::transactions_table() ),
				'relationship_floor' => self::max_id( self::relationships_table() ),
			);
			update_option( PaymentHistoryCompatibility::STATE_OPTION, $state, false );
		}

		if ( function_exists( 'wp_next_scheduled' ) && ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + MINUTE_IN_SECONDS, self::CRON_SCHEDULE, self::CRON_HOOK );
		}
	}

	/**
	 * The recorded coverage floors, or null while shadow writes are off.
	 *
	 * @return array{enabled_at: string, transaction_floor: int, relationship_floor: int}|null
	 */
	public static function coverage() {
		$state = PaymentHistoryCompatibility::get_state();
		$cover = $state['shadow_writes'] ?? null;
		if ( ! is_array( $cover ) || empty( $cover['enabled_at'] ) ) {
			return null;
		}
		return array(
			'enabled_at'         => (string) $cover['enabled_at'],
			'transaction_floor'  => (int) ( $cover['transaction_floor'] ?? 0 ),
			'relationship_floor' => (int) ( $cover['relationship_floor'] ?? 0 ),
		);
	}

	/**
	 * Connector created an attempt: queue it, and the relationships its
	 * metadata names.
	 *
	 * @param int   $transaction_id Transaction ID.
	 * @param array $line_items     Line items.
	 * @param array $args           Creation arguments, with metadata.
	 * @return void
	 */
	public static function on_transaction_created( $transaction_id, $line_items = array(), $args = array() ) {
		unset( $line_items );
		if ( ! PaymentHistoryCompatibility::shadow_write_coverage() ) {
			return;
		}

		$metadata = PaymentAttributionDatabase::decode_metadata( is_array( $args ) ? ( $args['metadata'] ?? null ) : null );
		if ( ! empty( $metadata['fee_payment_id'] ) ) {
			return;
		}

		foreach ( self::named_relationships( $metadata ) as $relationship_id ) {
			self::queue( PaymentShadowWork::KIND_RELATIONSHIP, $relationship_id );
		}
		self::queue( PaymentShadowWork::KIND_TRANSACTION, (int) $transaction_id );
	}

	/**
	 * An attempt's status changed: Audience may have moved its relationships
	 * on, and work left unresolved may resolve now.
	 *
	 * @param object $payment     Payment from Connector.
	 * @param object $transaction Transaction.
	 * @return void
	 */
	public static function on_status_changed( $payment, $transaction ) {
		unset( $payment );
		if ( ! PaymentHistoryCompatibility::shadow_write_coverage() || ! is_object( $transaction ) || empty( $transaction->id ) ) {
			return;
		}

		$coverage = self::coverage();
		$metadata = PaymentAttributionDatabase::decode_metadata( $transaction->metadata ?? null );
		if ( ! empty( $metadata['fee_payment_id'] ) ) {
			return;
		}

		$relationship_ids = self::named_relationships( $metadata );
		foreach ( ( new PaymentAttributionDatabase() )->ledger_rows( (int) $transaction->id ) as $row ) {
			$relationship_ids[] = (int) $row['event_participant_id'];
		}
		foreach ( array_unique( $relationship_ids ) as $relationship_id ) {
			self::queue( PaymentShadowWork::KIND_RELATIONSHIP, $relationship_id );
		}

		if ( (int) $transaction->id > $coverage['transaction_floor'] ) {
			self::queue( PaymentShadowWork::KIND_TRANSACTION, (int) $transaction->id );
		}
	}

	/**
	 * Queue work, persisted at once so a request that dies before shutdown
	 * leaves it for the retry cron.
	 *
	 * @param string $kind      Kind.
	 * @param int    $source_id Source ID.
	 * @return void
	 */
	public static function queue( $kind, $source_id ) {
		$source_id = (int) $source_id;
		if ( $source_id <= 0 ) {
			return;
		}

		PaymentShadowWork::enqueue( $kind, $source_id );
		self::$queued[ $kind ][ $source_id ] = true;

		if ( ! self::$shutdown_registered ) {
			self::$shutdown_registered = true;
			add_action( 'shutdown', array( static::class, 'process_queued' ), 1 );
		}
	}

	/**
	 * Shutdown: do the work this request queued, relationships first so
	 * the purchases its transactions need exist.
	 *
	 * @return void
	 */
	public static function process_queued() {
		$queued       = self::$queued;
		self::$queued = array(
			PaymentShadowWork::KIND_RELATIONSHIP => array(),
			PaymentShadowWork::KIND_TRANSACTION  => array(),
		);

		// After a fatal error a writer may have left a database transaction
		// open; starting another one would commit its partial work. The
		// queued rows wait for the retry cron instead.
		$error = error_get_last();
		if ( $error && in_array( $error['type'], array( E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR ), true ) ) {
			return;
		}

		foreach ( array( PaymentShadowWork::KIND_RELATIONSHIP, PaymentShadowWork::KIND_TRANSACTION ) as $kind ) {
			foreach ( array_keys( $queued[ $kind ] ) as $source_id ) {
				// Work queued inside a database transaction its writer rolled
				// back is gone, together with what it was about.
				if ( PaymentShadowWork::get( $kind, (int) $source_id ) ) {
					self::process( $kind, (int) $source_id );
				}
			}
		}
	}

	/**
	 * Cron: retry due work, then sweep for relationships out of step.
	 *
	 * @return void
	 */
	public static function run_scheduled() {
		if ( ! PaymentHistoryCompatibility::shadow_write_coverage() ) {
			return;
		}

		self::sweep();
		self::process_due( self::BATCH_SIZE );
	}

	/**
	 * Process queue rows whose next attempt is due, relationships first.
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
		$coverage = self::coverage();
		if ( ! $coverage ) {
			return 'failed';
		}

		try {
			if ( PaymentShadowWork::KIND_RELATIONSHIP === $kind ) {
				$result = ShadowPurchases::sync( $source_id, $coverage['relationship_floor'] );
				if ( is_wp_error( $result ) ) {
					PaymentShadowWork::defer( $kind, $source_id, PaymentShadowWork::STATUS_FAILED, $result->get_error_code(), array( 'message' => $result->get_error_message() ) );
					return 'failed';
				}
				PaymentShadowWork::complete( $kind, $source_id );
				return 'done';
			}

			return self::process_transaction( $source_id );
		} catch ( \Throwable $error ) {
			PaymentShadowWork::defer( $kind, $source_id, PaymentShadowWork::STATUS_FAILED, 'shadow_write_exception', array( 'message' => $error->getMessage() ) );
			return 'failed';
		}
	}

	/**
	 * Link one transaction to its purchases.
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return string Outcome.
	 */
	private static function process_transaction( $transaction_id ) {
		$kind        = PaymentShadowWork::KIND_TRANSACTION;
		$transaction = PaymentAttributionDatabase::transaction( $transaction_id );
		if ( ! $transaction ) {
			$code = PaymentHistoryCompatibility::payment_information_available() ? 'missing_transaction' : 'payment_information_unavailable';
			PaymentShadowWork::defer( $kind, $transaction_id, 'missing_transaction' === $code ? PaymentShadowWork::STATUS_UNRESOLVED : PaymentShadowWork::STATUS_FAILED, $code );
			return 'missing_transaction' === $code ? 'unresolved' : 'failed';
		}

		$result = ( new PaymentAttribution( new PaymentAttributionDatabase() ) )->attribute( $transaction );
		if ( 'out_of_scope' === $result['outcome'] ) {
			PaymentShadowWork::complete( $kind, $transaction_id );
			return 'done';
		}
		if ( 'unresolved' === $result['outcome'] ) {
			PaymentShadowWork::defer( $kind, $transaction_id, PaymentShadowWork::STATUS_UNRESOLVED, (string) $result['reason'], $result['detail'] );
			return 'unresolved';
		}

		$links = array_map(
			static function ( $link ) {
				return $link + array( 'attribution' => SignupPaymentLink::ATTRIBUTION_LIVE );
			},
			$result['links']
		);

		$written = PaymentLinks::write( $transaction_id, $links );
		if ( is_wp_error( $written ) ) {
			PaymentShadowWork::defer( $kind, $transaction_id, PaymentShadowWork::STATUS_FAILED, $written->get_error_code(), array( 'message' => $written->get_error_message() ) );
			return 'failed';
		}

		foreach ( array_unique( array_column( $links, 'signup_id' ) ) as $signup_id ) {
			ShadowPurchases::refresh_amount( (int) $signup_id );
		}

		PaymentShadowWork::complete( $kind, $transaction_id );
		return 'done';
	}

	/**
	 * Queue relationships that are out of step with their shadow purchase,
	 * or that are new Audience-only admissions without one, and process
	 * them. Catches every writer, including organizers adding participants
	 * and Audience's expiry cron.
	 *
	 * @param int $limit Most relationships per kind of difference.
	 * @return int Relationships queued.
	 */
	public static function sweep( $limit = 100 ) {
		$coverage = self::coverage();
		if ( ! $coverage || ! ShadowPurchases::audience_tables_exist() ) {
			return 0;
		}

		$relationship_ids = array_unique(
			array_merge(
				self::find_new_admissions( $coverage['relationship_floor'], (int) $limit ),
				self::find_out_of_step( (int) $limit ),
				self::find_activities_out_of_step( (int) $limit )
			)
		);

		foreach ( $relationship_ids as $relationship_id ) {
			PaymentShadowWork::enqueue( PaymentShadowWork::KIND_RELATIONSHIP, (int) $relationship_id );
			self::process( PaymentShadowWork::KIND_RELATIONSHIP, (int) $relationship_id );
		}
		return count( $relationship_ids );
	}

	/**
	 * Signed-up relationships after the floor with no purchase, which are
	 * admissions by §4.1.
	 *
	 * @param int $floor Relationship floor.
	 * @param int $limit Most rows.
	 * @return int[]
	 */
	private static function find_new_admissions( $floor, $limit ) {
		global $wpdb;

		return array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT ep.id FROM %i AS ep
					WHERE ep.id > %d AND ep.label = 'signed_up'
					AND NOT EXISTS ( SELECT 1 FROM %i AS bp WHERE bp.legacy_event_participant_id = ep.id )
					AND NOT EXISTS (
						SELECT 1 FROM %i AS s
						WHERE s.participant_id = ep.participant_id
						AND ( s.event_date_id = ep.event_date_id OR ( ep.ticket_type_id IS NOT NULL AND s.ticket_type_id = ep.ticket_type_id ) )
						AND ( s.status = 'confirmed' OR ( s.status = 'pending_payment' AND s.payment_expires_at IS NOT NULL AND s.payment_expires_at > %s ) )
					)
					AND NOT EXISTS (
						SELECT 1 FROM %i AS t
						WHERE t.holder_participant_id = ep.participant_id AND t.event_date_id = ep.event_date_id
						AND t.status NOT IN ( 'failed', 'expired', 'cancelled', 'refunded' )
					)
					ORDER BY ep.id ASC LIMIT %d",
					self::relationships_table(),
					(int) $floor,
					$wpdb->prefix . 'fair_events_signups',
					$wpdb->prefix . 'fair_events_signups',
					gmdate( 'Y-m-d H:i:s' ),
					$wpdb->prefix . 'fair_events_tickets',
					(int) $limit
				)
			)
		);
	}

	/**
	 * Relationships whose shadow purchase doesn't reflect them: deleted,
	 * relabelled, paid, re-held, moved or retyped.
	 *
	 * @param int $limit Most rows.
	 * @return int[]
	 */
	private static function find_out_of_step( $limit ) {
		global $wpdb;

		$now = gmdate( 'Y-m-d H:i:s' );
		return array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT s.legacy_event_participant_id FROM %i AS s
					LEFT JOIN %i AS ep ON ep.id = s.legacy_event_participant_id
					WHERE s.legacy_event_participant_id IS NOT NULL AND (
						( ep.id IS NULL AND s.status IN ( 'confirmed', 'pending_payment' ) )
						OR ( ep.label = 'signed_up' AND s.status <> 'confirmed' )
						OR ( ep.label = 'pending_payment' AND ep.payment_expires_at > %s AND ( s.status <> 'pending_payment' OR NOT ( s.payment_expires_at <=> ep.payment_expires_at ) ) )
						OR ( ep.label IN ( 'interested', 'collaborator' ) AND s.status IN ( 'confirmed', 'pending_payment' ) )
						OR ( ep.id IS NOT NULL AND ( ep.event_date_id <> s.event_date_id OR NOT ( ep.ticket_type_id <=> s.ticket_type_id ) ) )
					)
					ORDER BY s.id ASC LIMIT %d",
					$wpdb->prefix . 'fair_events_signups',
					self::relationships_table(),
					$now,
					(int) $limit
				)
			)
		);
	}

	/**
	 * Relationships with a shadow purchase whose participant-scope
	 * activities aren't on its unit in the same state.
	 *
	 * @param int $limit Most rows.
	 * @return int[]
	 */
	private static function find_activities_out_of_step( $limit ) {
		global $wpdb;

		return array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT DISTINCT epo.event_participant_id FROM %i AS epo
					INNER JOIN %i AS s ON s.legacy_event_participant_id = epo.event_participant_id
					INNER JOIN %i AS t ON t.signup_id = s.id AND t.unit_position = 1
					LEFT JOIN %i AS ta ON ta.ticket_id = t.id AND ta.ticket_option_id = epo.ticket_option_id
					WHERE epo.ticket_id IS NULL
					AND ( epo.status = 'confirmed' OR ( epo.status = 'pending_payment' AND epo.expires_at > %s ) )
					AND ( ta.id IS NULL OR ta.status <> epo.status )
					LIMIT %d",
					$wpdb->prefix . 'fair_audience_event_participant_options',
					$wpdb->prefix . 'fair_events_signups',
					$wpdb->prefix . 'fair_events_tickets',
					$wpdb->prefix . 'fair_events_ticket_activities',
					gmdate( 'Y-m-d H:i:s' ),
					(int) $limit
				)
			)
		);
	}

	/**
	 * Relationship IDs a transaction's metadata names.
	 *
	 * @param array $metadata Metadata.
	 * @return int[]
	 */
	private static function named_relationships( array $metadata ) {
		$ids = array();
		if ( isset( $metadata['event_participant_ids'] ) && is_array( $metadata['event_participant_ids'] ) ) {
			$ids = $metadata['event_participant_ids'];
		}
		if ( ! empty( $metadata['event_participant_id'] ) ) {
			$ids[] = $metadata['event_participant_id'];
		}
		return array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) );
	}

	/**
	 * Highest ID in a table, 0 when it is empty or missing.
	 *
	 * @param string $table Table name.
	 * @return int
	 */
	private static function max_id( $table ) {
		global $wpdb;

		if ( $table !== $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) ) ) {
			return 0;
		}
		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COALESCE(MAX(id), 0) FROM %i', $table ) );
	}

	/**
	 * Connector transactions table.
	 *
	 * @return string
	 */
	private static function transactions_table() {
		global $wpdb;

		if ( class_exists( \FairPaymentsConnector\Database\Schema::class ) && method_exists( \FairPaymentsConnector\Database\Schema::class, 'get_payments_table_name' ) ) {
			return \FairPaymentsConnector\Database\Schema::get_payments_table_name();
		}
		return $wpdb->prefix . 'fair_payment_transactions';
	}

	/**
	 * Audience relationships table.
	 *
	 * @return string
	 */
	private static function relationships_table() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_event_participants';
	}
}
