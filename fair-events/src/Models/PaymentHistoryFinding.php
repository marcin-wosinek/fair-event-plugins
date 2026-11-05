<?php
/**
 * Payment history findings
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Records the payment history backfill could not attribute, or attributed
 * with a note, by §6.2 reason (PAYMENT_HISTORY_MIGRATION.md §6.2, §8.9).
 * One row per (mode, reason, source): recording the same finding again
 * refreshes its detail instead of adding a row. A finding a later pass
 * resolves stays, marked `resolved`, so the report keeps its history.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- generated placeholder lists and code-defined columns.
 */
class PaymentHistoryFinding {

	const MODE_DRY_RUN  = 'dry_run';
	const MODE_BACKFILL = 'backfill';

	const STATUS_OPEN     = 'open';
	const STATUS_RESOLVED = 'resolved';

	const SOURCE_TRANSACTION  = 'transaction';
	const SOURCE_RELATIONSHIP = 'relationship';
	const SOURCE_LEDGER_ROW   = 'ledger_row';
	const SOURCE_SIGNUP       = 'signup';
	const SOURCE_LINK         = 'link';

	/**
	 * Every §6.2 reason, plus the backfill's own `existing_link_conflict`
	 * (§8.9).
	 */
	const REASONS = array(
		'no_evidence',
		'allocation_mismatch',
		'amount_mismatch',
		'ambiguous_activity',
		'ambiguous_activity_charge',
		'ambiguous_upgrade',
		'duplicate_series_relationship',
		'multiple_paid_attempts',
		'missing_transaction',
		'currency_mismatch',
		'unsupported_refund_record',
		'participant_relationship_conflict',
		'existing_link_conflict',
	);

	/**
	 * Informational reasons: the record is attributed, the finding is only
	 * for review, and it never makes revenue incomplete.
	 */
	const INFORMATIONAL = array( 'amount_mismatch', 'multiple_paid_attempts', 'unsupported_refund_record' );

	/**
	 * Table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_payment_history_findings';
	}

	/**
	 * Record a finding, or refresh it and reopen it when it was resolved.
	 *
	 * @param string   $mode          Mode.
	 * @param string   $reason        §6.2 reason.
	 * @param string   $source_type   Source type.
	 * @param int      $source_id     Source ID.
	 * @param int|null $event_date_id Event date the record concerns.
	 * @param array    $detail        Context.
	 * @return bool
	 */
	public static function record( $mode, $reason, $source_type, $source_id, $event_date_id = null, array $detail = array() ) {
		global $wpdb;

		$now = gmdate( 'Y-m-d H:i:s' );
		return false !== $wpdb->query(
			$wpdb->prepare(
				'INSERT INTO %i (mode, reason, source_type, source_id, event_date_id, status, detail, first_seen_at, last_seen_at)
				VALUES (%s, %s, %s, %d, NULLIF(%d, 0), %s, %s, %s, %s)
				ON DUPLICATE KEY UPDATE event_date_id = VALUES(event_date_id), status = VALUES(status), detail = VALUES(detail), last_seen_at = VALUES(last_seen_at)',
				self::table(),
				(string) $mode,
				(string) $reason,
				(string) $source_type,
				(int) $source_id,
				(int) $event_date_id,
				self::STATUS_OPEN,
				(string) wp_json_encode( $detail ),
				$now,
				$now
			)
		);
	}

	/**
	 * Mark a source's open findings resolved, except the given reasons.
	 *
	 * @param string   $mode        Mode.
	 * @param string   $source_type Source type.
	 * @param int      $source_id   Source ID.
	 * @param string[] $keep        Reasons that still hold.
	 * @return void
	 */
	public static function resolve_source( $mode, $source_type, $source_id, array $keep = array() ) {
		global $wpdb;

		$keep     = array_values( array_filter( array_map( 'strval', $keep ) ) );
		$keep_sql = $keep ? ' AND reason NOT IN ( ' . implode( ', ', array_fill( 0, count( $keep ), '%s' ) ) . ' )' : '';

		$wpdb->query(
			$wpdb->prepare(
				"UPDATE %i SET status = %s, last_seen_at = %s WHERE mode = %s AND source_type = %s AND source_id = %d AND status = %s{$keep_sql}",
				array_merge(
					array( self::table(), self::STATUS_RESOLVED, gmdate( 'Y-m-d H:i:s' ), (string) $mode, (string) $source_type, (int) $source_id, self::STATUS_OPEN ),
					$keep
				)
			)
		);
	}

	/**
	 * Remove every finding of a mode; a new dry run starts from nothing.
	 *
	 * @param string $mode Mode.
	 * @return void
	 */
	public static function clear( $mode ) {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE mode = %s', self::table(), (string) $mode ) );
	}

	/**
	 * Open findings per reason.
	 *
	 * @param string $mode Mode.
	 * @return array<string, int>
	 */
	public static function count_open( $mode ) {
		global $wpdb;

		$counts = array();
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT reason, COUNT(*) AS total FROM %i WHERE mode = %s AND status = %s GROUP BY reason ORDER BY reason', self::table(), (string) $mode, self::STATUS_OPEN ),
			ARRAY_A
		) as $row ) {
			$counts[ (string) $row['reason'] ] = (int) $row['total'];
		}
		return $counts;
	}

	/**
	 * Findings, newest last, optionally filtered.
	 *
	 * @param string $mode    Mode.
	 * @param array  $filters reason, event_date_id, status, source_type, source_id, after_id, limit.
	 * @return array[] Rows with decoded detail.
	 */
	public static function query( $mode, array $filters = array() ) {
		global $wpdb;

		$where = array( 'mode = %s' );
		$args  = array( (string) $mode );
		foreach ( array(
			'reason'        => '%s',
			'status'        => '%s',
			'source_type'   => '%s',
			'source_id'     => '%d',
			'event_date_id' => '%d',
		) as $field => $placeholder ) {
			if ( isset( $filters[ $field ] ) && '' !== $filters[ $field ] ) {
				$where[] = "{$field} = {$placeholder}";
				$args[]  = $filters[ $field ];
			}
		}
		$where[] = 'id > %d';
		$args[]  = (int) ( $filters['after_id'] ?? 0 );
		$args[]  = max( 1, min( 500, (int) ( $filters['limit'] ?? 100 ) ) );

		$where_sql = implode( ' AND ', $where );

		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE {$where_sql} ORDER BY id ASC LIMIT %d",
				array_merge( array( self::table() ), $args )
			),
			ARRAY_A
		);

		return array_map(
			static function ( $row ) {
				$row['id']            = (int) $row['id'];
				$row['source_id']     = (int) $row['source_id'];
				$row['event_date_id'] = null === $row['event_date_id'] ? null : (int) $row['event_date_id'];
				$row['detail']        = json_decode( (string) $row['detail'], true );
				return $row;
			},
			$rows
		);
	}

	/**
	 * Whether a source has an open finding with one of the reasons.
	 *
	 * @param string   $mode        Mode.
	 * @param string   $source_type Source type.
	 * @param int      $source_id   Source ID.
	 * @param string[] $reasons     Reasons; empty for any.
	 * @return bool
	 */
	public static function is_open( $mode, $source_type, $source_id, array $reasons = array() ) {
		global $wpdb;

		$reason_sql = $reasons ? ' AND reason IN ( ' . implode( ', ', array_fill( 0, count( $reasons ), '%s' ) ) . ' )' : '';
		return (bool) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT 1 FROM %i WHERE mode = %s AND source_type = %s AND source_id = %d AND status = %s{$reason_sql} LIMIT 1",
				array_merge( array( self::table(), (string) $mode, (string) $source_type, (int) $source_id, self::STATUS_OPEN ), array_values( $reasons ) )
			)
		);
	}
}
