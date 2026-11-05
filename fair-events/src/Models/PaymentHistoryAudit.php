<?php
/**
 * Payment history reconciliation audit
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Append-only record of administrators' reconciliation actions
 * (PAYMENT_HISTORY_MIGRATION.md §6.3): who did what, when (UTC), which
 * finding and reason it resolved, the note they entered, and the finding and
 * link state before and after. Rows are only inserted and read; nothing
 * here updates or deletes one.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- code-defined WHERE clause with its own placeholders.
 */
class PaymentHistoryAudit {

	const ACTION_LINK   = 'link';
	const ACTION_UNLINK = 'unlink';
	const ACTION_REVIEW = 'review';

	/**
	 * Table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_payment_history_audit';
	}

	/**
	 * Append one record. Callers write it in the same database transaction
	 * as the change it describes.
	 *
	 * @param array $record action, finding_id, reason, transaction_id, user_id, note, before, after.
	 * @return int|false The new record's ID, or false when it couldn't be stored.
	 */
	public static function append( array $record ) {
		global $wpdb;

		$inserted = $wpdb->insert(
			self::table(),
			array(
				'action'         => (string) $record['action'],
				'finding_id'     => empty( $record['finding_id'] ) ? null : (int) $record['finding_id'],
				'reason'         => empty( $record['reason'] ) ? null : (string) $record['reason'],
				'transaction_id' => empty( $record['transaction_id'] ) ? null : (int) $record['transaction_id'],
				'user_id'        => (int) $record['user_id'],
				'note'           => (string) $record['note'],
				'before_state'   => (string) wp_json_encode( $record['before'] ?? array() ),
				'after_state'    => (string) wp_json_encode( $record['after'] ?? array() ),
				'created_at'     => gmdate( 'Y-m-d H:i:s' ),
			),
			array( '%s', '%d', '%s', '%d', '%d', '%s', '%s', '%s', '%s' )
		);
		return 1 === $inserted ? (int) $wpdb->insert_id : false;
	}

	/**
	 * Records, newest first.
	 *
	 * @param array $filters finding_id, transaction_id, limit, offset.
	 * @return array[] Records with decoded state.
	 */
	public static function query( array $filters = array() ) {
		global $wpdb;

		list( $where_sql, $args ) = self::where( $filters );
		$args[]                   = max( 1, min( 200, (int) ( $filters['limit'] ?? 50 ) ) );
		$args[]                   = max( 0, (int) ( $filters['offset'] ?? 0 ) );

		return array_map(
			static function ( $row ) {
				return array(
					'id'             => (int) $row['id'],
					'action'         => (string) $row['action'],
					'finding_id'     => null === $row['finding_id'] ? null : (int) $row['finding_id'],
					'reason'         => $row['reason'],
					'transaction_id' => null === $row['transaction_id'] ? null : (int) $row['transaction_id'],
					'user_id'        => (int) $row['user_id'],
					'note'           => (string) $row['note'],
					'before'         => json_decode( (string) $row['before_state'], true ),
					'after'          => json_decode( (string) $row['after_state'], true ),
					'created_at'     => (string) $row['created_at'],
				);
			},
			(array) $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM %i WHERE {$where_sql} ORDER BY id DESC LIMIT %d OFFSET %d",
					array_merge( array( self::table() ), $args )
				),
				ARRAY_A
			)
		);
	}

	/**
	 * How many records match.
	 *
	 * @param array $filters See query().
	 * @return int
	 */
	public static function count( array $filters = array() ) {
		global $wpdb;

		list( $where_sql, $args ) = self::where( $filters );
		return (int) $wpdb->get_var(
			$wpdb->prepare( "SELECT COUNT(*) FROM %i WHERE {$where_sql}", array_merge( array( self::table() ), $args ) )
		);
	}

	/**
	 * WHERE clause and arguments.
	 *
	 * @param array $filters Filters.
	 * @return array{0: string, 1: array}
	 */
	private static function where( array $filters ) {
		$where = array( '1 = 1' );
		$args  = array();
		if ( ! empty( $filters['finding_id'] ) && ! empty( $filters['transaction_id'] ) ) {
			$where[] = '( finding_id = %d OR transaction_id = %d )';
			$args[]  = (int) $filters['finding_id'];
			$args[]  = (int) $filters['transaction_id'];
		} elseif ( ! empty( $filters['finding_id'] ) ) {
			$where[] = 'finding_id = %d';
			$args[]  = (int) $filters['finding_id'];
		} elseif ( ! empty( $filters['transaction_id'] ) ) {
			$where[] = 'transaction_id = %d';
			$args[]  = (int) $filters['transaction_id'];
		}
		return array( implode( ' AND ', $where ), $args );
	}
}
