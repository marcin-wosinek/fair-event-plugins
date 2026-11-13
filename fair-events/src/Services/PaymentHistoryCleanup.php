<?php
/**
 * Removal of the payment history migration's own storage
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\PaymentHistoryAudit;
use FairEvents\Models\PaymentHistoryFinding;

defined( 'WPINC' ) || die;

/**
 * The source-history cleanup (PAYMENT_HISTORY_MIGRATION.md §8.21): an
 * administrator's one-time removal of the storage only the migration
 * used, once nothing at runtime reads it (#2252–#2254).
 *
 * - Removed: the Fair Audience ledger table, the comparisons table, the
 *   migration's state, stage 4 and stage 5 options, and the findings of
 *   dry runs. Each finding citing a ledger row keeps a copy of that row
 *   in its detail first, so reconciliation and audit still show it.
 * - Kept: payment links, backfill findings, the audit, the recovery
 *   queue, purchase provenance, Fair Audience's relationships and fee
 *   payments, the completion evidence and the staging verification.
 * - Runs only when PaymentHistoryUpgrade::cleanup_readiness() is ready,
 *   checked again under a named lock at execution time, and records its
 *   own completion in RECORD_OPTION (never removed), so a repeat is a
 *   no-op.
 *
 * MySQL commits implicitly before DROP TABLE, so the snapshot and the
 * option removal commit first, then the tables are dropped, then the
 * audit and the completion record are written. Every step is safe to
 * repeat: an interrupted run is finished by running it again.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.DirectDatabaseQuery.SchemaChange
 */
class PaymentHistoryCleanup {

	/**
	 * Option recording that the cleanup ran. Durable: never deleted.
	 */
	const RECORD_OPTION = 'fair_events_payment_history_cleanup';

	/**
	 * Audit action recording the cleanup.
	 */
	const AUDIT_ACTION = 'cleanup';

	/**
	 * Audit reason recording the cleanup.
	 */
	const AUDIT_REASON = 'source_history_cleanup';

	/**
	 * Tables removed, without the prefix.
	 */
	const TABLES = array(
		'fair_audience_event_participant_transactions',
		'fair_events_payment_history_comparisons',
	);

	/**
	 * Options removed.
	 */
	const OPTIONS = array(
		PaymentHistoryCompatibility::STATE_OPTION,
		PaymentHistoryCompatibility::CUTOVER_OPTION,
		PaymentHistoryCompatibility::READERS_OPTION,
	);

	/**
	 * The ledger table, without the prefix.
	 */
	const LEDGER_TABLE = 'fair_audience_event_participant_transactions';

	/**
	 * Seconds run() waits for the lock.
	 */
	const LOCK_TIMEOUT = 5;

	/**
	 * The recorded cleanup, or null.
	 *
	 * @return array|null completed_at, user_id, user_name, backup_confirmed_at,
	 *                    removed, snapshotted_findings, audit_id, plugin_versions.
	 */
	public static function get_record() {
		$record = get_option( self::RECORD_OPTION, null );
		if ( ! is_array( $record ) || empty( $record['completed_at'] ) ) {
			return null;
		}
		$user                = get_userdata( (int) ( $record['user_id'] ?? 0 ) );
		$record['user_name'] = $user ? (string) $user->display_name : null;
		return $record;
	}

	/**
	 * Remove the migration's storage.
	 *
	 * @param array $args backup_confirmed (required), user_id.
	 * @return array|\WP_Error performed (false for a repeat) and record; or
	 *                         backup_required (400), cleanup_not_applicable,
	 *                         cleanup_blocked with `blockers`, cleanup_busy
	 *                         (409) or cleanup_failed (500).
	 */
	public static function run( array $args ) {
		if ( empty( $args['backup_confirmed'] ) ) {
			return self::error( 'backup_required', 400, 'Confirm that a fresh database backup was taken before removing the old payment records.' );
		}

		$refused = self::refusal( PaymentHistoryUpgrade::readiness_now() );
		if ( $refused ) {
			return $refused;
		}

		global $wpdb;
		$lock = substr( $wpdb->prefix . self::RECORD_OPTION, 0, 64 );
		if ( '1' !== (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $lock, self::LOCK_TIMEOUT ) ) ) {
			return self::error( 'cleanup_busy', 409, 'The old payment records are being removed already. Try again in a moment.' );
		}

		try {
			return self::run_locked( (int) ( $args['user_id'] ?? get_current_user_id() ) );
		} finally {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock ) );
		}
	}

	/**
	 * The cleanup under its lock, decided again from the database.
	 *
	 * @param int $user_id Administrator.
	 * @return array|\WP_Error
	 */
	private static function run_locked( $user_id ) {
		global $wpdb;

		// Another request may have run the cleanup, or the site may have
		// changed, since the first check.
		self::flush_option_cache();
		$refused = self::refusal( PaymentHistoryUpgrade::readiness_now() );
		if ( $refused ) {
			return $refused;
		}

		$backup_confirmed_at = gmdate( 'Y-m-d H:i:s' );
		$before              = self::inventory();

		// 1. Keep the ledger rows the findings cite, and remove the
		// migration's own records, together.
		$wpdb->query( 'START TRANSACTION' );
		$snapshotted = self::snapshot_ledger_rows( in_array( $wpdb->prefix . self::LEDGER_TABLE, $before['tables'], true ) );
		$removed     = false !== $snapshotted && false !== $wpdb->query(
			$wpdb->prepare( 'DELETE FROM %i WHERE mode = %s', PaymentHistoryFinding::table(), PaymentHistoryFinding::MODE_DRY_RUN )
		);
		foreach ( $before['options'] as $option ) {
			$removed = $removed && delete_option( $option );
		}
		if ( ! $removed ) {
			$wpdb->query( 'ROLLBACK' );
			self::flush_option_cache();
			return self::failed();
		}
		$wpdb->query( 'COMMIT' );

		// 2. Drop the tables. Each drop commits on its own; a failure
		// leaves the rest for a repeat.
		foreach ( $before['tables'] as $table ) {
			if ( false === $wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $table ) ) ) {
				return self::failed();
			}
		}

		// 3. Record what was done.
		$record = array(
			'completed_at'         => gmdate( 'Y-m-d H:i:s' ),
			'user_id'              => (int) $user_id,
			'backup_confirmed_at'  => $backup_confirmed_at,
			'removed'              => array(
				'tables'           => $before['tables'],
				'options'          => $before['options'],
				'dry_run_findings' => $before['dry_run_findings'],
				'ledger_rows'      => $before['ledger_rows'],
			),
			'snapshotted_findings' => (int) $snapshotted,
			'plugin_versions'      => PaymentHistoryUpgrade::plugin_versions(),
		);

		$wpdb->query( 'START TRANSACTION' );
		$audit_id           = PaymentHistoryAudit::append(
			array(
				'action'  => self::AUDIT_ACTION,
				'reason'  => self::AUDIT_REASON,
				'user_id' => (int) $user_id,
				'note'    => '',
				'before'  => array( 'storage' => $before ),
				'after'   => array( 'cleanup' => $record ),
			)
		);
		$record['audit_id'] = $audit_id;
		if ( ! $audit_id || ! add_option( self::RECORD_OPTION, $record, '', false ) ) {
			$wpdb->query( 'ROLLBACK' );
			self::flush_option_cache();
			return self::failed();
		}
		$wpdb->query( 'COMMIT' );

		return array(
			'performed' => true,
			'record'    => self::get_record(),
		);
	}

	/**
	 * What the readiness forbids, as an error; a repeat is not refused.
	 *
	 * @param array $readiness From PaymentHistoryUpgrade::readiness_now().
	 * @return array|\WP_Error|null The repeat's result, the refusal, or null to go on.
	 */
	private static function refusal( array $readiness ) {
		if ( empty( $readiness['applicable'] ) ) {
			return self::error( 'cleanup_not_applicable', 409, 'This site never had old payment records to remove.' );
		}
		if ( ! empty( $readiness['completed'] ) ) {
			return array(
				'performed' => false,
				'record'    => $readiness['completed'],
			);
		}
		if ( $readiness['blockers'] ) {
			return self::error( 'cleanup_blocked', 409, 'The old payment records can’t be removed yet.', array( 'blockers' => $readiness['blockers'] ) );
		}
		return null;
	}

	/**
	 * Which of the storage removed is still on the site.
	 *
	 * @return array tables (prefixed names), options, dry_run_findings, ledger_rows.
	 */
	public static function inventory() {
		global $wpdb;

		$tables = array();
		foreach ( self::TABLES as $table ) {
			$name = $wpdb->prefix . $table;
			if ( $name === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $name ) ) ) ) {
				$tables[] = $name;
			}
		}

		$options = array();
		foreach ( self::OPTIONS as $option ) {
			if ( null !== $wpdb->get_var( $wpdb->prepare( 'SELECT option_id FROM %i WHERE option_name = %s', $wpdb->options, $option ) ) ) {
				$options[] = $option;
			}
		}

		$ledger = $wpdb->prefix . self::LEDGER_TABLE;
		return array(
			'tables'           => $tables,
			'options'          => $options,
			'dry_run_findings' => (int) $wpdb->get_var(
				$wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE mode = %s', PaymentHistoryFinding::table(), PaymentHistoryFinding::MODE_DRY_RUN )
			),
			'ledger_rows'      => in_array( $ledger, $tables, true )
				? (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $ledger ) )
				: 0,
		);
	}

	/**
	 * Copy the ledger row each backfill finding cites into its detail
	 * (`ledger_row`, null when the row no longer exists). A finding that
	 * already has its copy keeps it.
	 *
	 * @param bool $ledger_exists Whether the ledger table is still there.
	 * @return int|false Findings given a copy, or false on a database error.
	 */
	private static function snapshot_ledger_rows( $ledger_exists ) {
		global $wpdb;

		$findings = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, source_id, detail FROM %i WHERE mode = %s AND source_type = %s ORDER BY id FOR UPDATE',
				PaymentHistoryFinding::table(),
				PaymentHistoryFinding::MODE_BACKFILL,
				PaymentHistoryFinding::SOURCE_LEDGER_ROW
			),
			ARRAY_A
		);
		if ( ! is_array( $findings ) ) {
			return false;
		}

		$ledger = $wpdb->prefix . self::LEDGER_TABLE;
		$count  = 0;
		foreach ( $findings as $finding ) {
			$detail = json_decode( (string) $finding['detail'], true );
			$detail = is_array( $detail ) ? $detail : array();
			if ( array_key_exists( 'ledger_row', $detail ) ) {
				continue;
			}

			$row = $ledger_exists
				? $wpdb->get_row(
					$wpdb->prepare( 'SELECT id, event_participant_id, transaction_id, kind, created_at FROM %i WHERE id = %d', $ledger, (int) $finding['source_id'] ),
					ARRAY_A
				)
				: null;

			$detail['ledger_row'] = $row
				? array(
					'id'                   => (int) $row['id'],
					'event_participant_id' => (int) $row['event_participant_id'],
					'transaction_id'       => (int) $row['transaction_id'],
					'kind'                 => (string) $row['kind'],
					'created_at'           => null === $row['created_at'] ? null : (string) $row['created_at'],
				)
				: null;

			$updated = $wpdb->update(
				PaymentHistoryFinding::table(),
				array( 'detail' => (string) wp_json_encode( $detail ) ),
				array( 'id' => (int) $finding['id'] ),
				array( '%s' ),
				array( '%d' )
			);
			if ( false === $updated ) {
				return false;
			}
			++$count;
		}
		return $count;
	}

	/**
	 * Forget cached options the cleanup reads or removes.
	 *
	 * @return void
	 */
	private static function flush_option_cache() {
		foreach ( array_merge( self::OPTIONS, array( self::RECORD_OPTION, PaymentHistoryUpgrade::EVIDENCE_OPTION, PaymentHistoryUpgrade::STAGING_OPTION ) ) as $option ) {
			wp_cache_delete( $option, 'options' );
		}
		wp_cache_delete( 'alloptions', 'options' );
		wp_cache_delete( 'notoptions', 'options' );
	}

	/**
	 * The error when a step couldn't be stored.
	 *
	 * @return \WP_Error
	 */
	private static function failed() {
		return self::error( 'cleanup_failed', 500, 'Not all the old payment records could be removed. Nothing still in use was changed; try again to finish.' );
	}

	/**
	 * An error with its HTTP status.
	 *
	 * @param string $code    Code.
	 * @param int    $status  HTTP status.
	 * @param string $message Message.
	 * @param array  $data    More data.
	 * @return \WP_Error
	 */
	private static function error( $code, $status, $message, array $data = array() ) {
		return new \WP_Error( $code, $message, array_merge( array( 'status' => (int) $status ), $data ) );
	}
}
