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
 * An administrator's decision (§6.3) marks it `reconciled` (linked by hand)
 * or `reviewed` (kept without a link); recording it again never reopens a
 * decided finding, so a re-run doesn't re-report it.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- generated placeholder lists and code-defined columns.
 */
class PaymentHistoryFinding {

	const MODE_DRY_RUN  = 'dry_run';
	const MODE_BACKFILL = 'backfill';

	const STATUS_OPEN       = 'open';
	const STATUS_RESOLVED   = 'resolved';
	const STATUS_RECONCILED = 'reconciled';
	const STATUS_REVIEWED   = 'reviewed';

	/**
	 * Statuses an administrator set; only reconciliation changes them.
	 */
	const DECIDED = array( self::STATUS_RECONCILED, self::STATUS_REVIEWED );

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
	 * A finding an administrator decided keeps its status.
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
				ON DUPLICATE KEY UPDATE event_date_id = VALUES(event_date_id), status = IF(status IN (%s, %s), status, VALUES(status)), detail = VALUES(detail), last_seen_at = VALUES(last_seen_at)',
				self::table(),
				(string) $mode,
				(string) $reason,
				(string) $source_type,
				(int) $source_id,
				(int) $event_date_id,
				self::STATUS_OPEN,
				(string) wp_json_encode( $detail ),
				$now,
				$now,
				self::STATUS_RECONCILED,
				self::STATUS_REVIEWED
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
	 * @param array  $filters reason, event_date_id, status (a status or a list), source_type, source_id,
	 *                        after_id, limit, offset.
	 * @return array[] Rows with decoded detail.
	 */
	public static function query( $mode, array $filters = array() ) {
		global $wpdb;

		list( $where_sql, $args ) = self::where( $mode, $filters );
		$args[]                   = max( 1, min( 500, (int) ( $filters['limit'] ?? 100 ) ) );
		$args[]                   = max( 0, (int) ( $filters['offset'] ?? 0 ) );

		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE {$where_sql} ORDER BY id ASC LIMIT %d OFFSET %d",
				array_merge( array( self::table() ), $args )
			),
			ARRAY_A
		);

		return array_map( array( self::class, 'hydrate' ), $rows );
	}

	/**
	 * How many findings match the filters of query().
	 *
	 * @param string $mode    Mode.
	 * @param array  $filters See query(); after_id applies, limit and offset don't.
	 * @return int
	 */
	public static function count( $mode, array $filters = array() ) {
		global $wpdb;

		list( $where_sql, $args ) = self::where( $mode, $filters );
		return (int) $wpdb->get_var(
			$wpdb->prepare( "SELECT COUNT(*) FROM %i WHERE {$where_sql}", array_merge( array( self::table() ), $args ) )
		);
	}

	/**
	 * Findings per event date and per reason, for filters.
	 *
	 * @param string          $mode   Mode.
	 * @param string|string[] $status Status or statuses; empty for any.
	 * @return array{event_dates: array<int, int>, reasons: array<string, int>} Counts; event date 0 is "no date".
	 */
	public static function facets( $mode, $status = array() ) {
		global $wpdb;

		list( $where_sql, $args ) = self::where( $mode, array( 'status' => $status ) );

		$facets = array(
			'event_dates' => array(),
			'reasons'     => array(),
		);
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare( "SELECT COALESCE(event_date_id, 0) AS event_date_id, COUNT(*) AS total FROM %i WHERE {$where_sql} GROUP BY COALESCE(event_date_id, 0) ORDER BY event_date_id", array_merge( array( self::table() ), $args ) ),
			ARRAY_A
		) as $row ) {
			$facets['event_dates'][ (int) $row['event_date_id'] ] = (int) $row['total'];
		}
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare( "SELECT reason, COUNT(*) AS total FROM %i WHERE {$where_sql} GROUP BY reason ORDER BY reason", array_merge( array( self::table() ), $args ) ),
			ARRAY_A
		) as $row ) {
			$facets['reasons'][ (string) $row['reason'] ] = (int) $row['total'];
		}
		return $facets;
	}

	/**
	 * Findings per status.
	 *
	 * @param string $mode Mode.
	 * @return array<string, int>
	 */
	public static function count_by_status( $mode ) {
		global $wpdb;

		$counts = array();
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT status, COUNT(*) AS total FROM %i WHERE mode = %s GROUP BY status ORDER BY status', self::table(), (string) $mode ),
			ARRAY_A
		) as $row ) {
			$counts[ (string) $row['status'] ] = (int) $row['total'];
		}
		return $counts;
	}

	/**
	 * One finding.
	 *
	 * @param int  $id         Finding ID.
	 * @param bool $for_update Lock the row inside the caller's database transaction.
	 * @return array|null Row with decoded detail.
	 */
	public static function get( $id, $for_update = false ) {
		global $wpdb;

		$sql = $for_update
			? $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d FOR UPDATE', self::table(), (int) $id )
			: $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', self::table(), (int) $id );
		$row = $wpdb->get_row( $sql, ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- prepared above.
		return $row ? self::hydrate( $row ) : null;
	}

	/**
	 * Change the status of findings that still have the expected one.
	 * Reconciliation only: the backfill records and resolves findings
	 * through record() and resolve_source().
	 *
	 * @param int[]  $ids      Finding IDs.
	 * @param string $from     Status they must have.
	 * @param string $to       New status.
	 * @return int Rows changed.
	 */
	public static function transition( array $ids, $from, $to ) {
		global $wpdb;

		$ids = array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) );
		if ( ! $ids ) {
			return 0;
		}
		return (int) $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET status = %s, last_seen_at = %s WHERE status = %s AND id IN ( ' . implode( ', ', array_fill( 0, count( $ids ), '%d' ) ) . ' )',
				array_merge( array( self::table(), (string) $to, gmdate( 'Y-m-d H:i:s' ), (string) $from ), $ids )
			)
		);
	}

	/**
	 * Whether an administrator decided any finding of a source.
	 *
	 * @param string $mode        Mode.
	 * @param string $source_type Source type.
	 * @param int    $source_id   Source ID.
	 * @return bool
	 */
	public static function is_decided( $mode, $source_type, $source_id ) {
		global $wpdb;

		return (bool) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT 1 FROM %i WHERE mode = %s AND source_type = %s AND source_id = %d AND status IN ( %s, %s ) LIMIT 1',
				self::table(),
				(string) $mode,
				(string) $source_type,
				(int) $source_id,
				self::STATUS_RECONCILED,
				self::STATUS_REVIEWED
			)
		);
	}

	/**
	 * WHERE clause and arguments for query() and count().
	 *
	 * @param string $mode    Mode.
	 * @param array  $filters Filters.
	 * @return array{0: string, 1: array}
	 */
	private static function where( $mode, array $filters ) {
		$where = array( 'mode = %s' );
		$args  = array( (string) $mode );
		foreach ( array(
			'reason'      => '%s',
			'source_type' => '%s',
			'source_id'   => '%d',
		) as $field => $placeholder ) {
			if ( isset( $filters[ $field ] ) && '' !== $filters[ $field ] ) {
				$where[] = "{$field} = {$placeholder}";
				$args[]  = $filters[ $field ];
			}
		}

		// Event date 0 selects findings with no known date.
		if ( isset( $filters['event_date_id'] ) && '' !== $filters['event_date_id'] ) {
			if ( (int) $filters['event_date_id'] > 0 ) {
				$where[] = 'event_date_id = %d';
				$args[]  = (int) $filters['event_date_id'];
			} else {
				$where[] = 'event_date_id IS NULL';
			}
		}

		$statuses = array_values( array_filter( array_map( 'strval', (array) ( $filters['status'] ?? array() ) ) ) );
		if ( $statuses ) {
			$where[] = 'status IN ( ' . implode( ', ', array_fill( 0, count( $statuses ), '%s' ) ) . ' )';
			$args    = array_merge( $args, $statuses );
		}

		$where[] = 'id > %d';
		$args[]  = (int) ( $filters['after_id'] ?? 0 );

		return array( implode( ' AND ', $where ), $args );
	}

	/**
	 * A stored row with typed fields and decoded detail.
	 *
	 * @param array $row Row.
	 * @return array
	 */
	private static function hydrate( array $row ) {
		$row['id']            = (int) $row['id'];
		$row['source_id']     = (int) $row['source_id'];
		$row['event_date_id'] = null === $row['event_date_id'] ? null : (int) $row['event_date_id'];
		$row['detail']        = json_decode( (string) $row['detail'], true );
		return $row;
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
