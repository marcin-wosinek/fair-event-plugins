<?php
/**
 * EventParticipant Transaction ledger repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

defined( 'WPINC' ) || die;

/**
 * Repository for the event-participant transaction ledger (junction table).
 *
 * Links each registration (event_participant row) to every
 * fair-payments-connector transaction it accumulates — the initial charge, any
 * later upgrade charge, and, in the future, refunds. This is the sole
 * registration↔transaction link and the source of truth for payment history.
 * Amounts and currency are read by joining fair_payment_transactions (single
 * source of truth), mirroring FeePaymentTransactionRepository.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventParticipantTransactionRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_event_participant_transactions';
	}

	/**
	 * Record a transaction against a registration. Idempotent: the unique key on
	 * (event_participant_id, transaction_id, kind) makes a repeated call (e.g. a
	 * retried Mollie webhook) a no-op via INSERT IGNORE.
	 *
	 * @param int    $event_participant_id Event participant row ID.
	 * @param int    $transaction_id       fair-payments-connector transaction ID.
	 * @param string $kind                 'charge' or 'refund'.
	 * @return bool True when a row was inserted or already present, false on error.
	 */
	public function record( $event_participant_id, $transaction_id, $kind = 'charge' ) {
		global $wpdb;

		if ( ! $event_participant_id || ! $transaction_id ) {
			return false;
		}

		$kind = in_array( $kind, array( 'charge', 'refund' ), true ) ? $kind : 'charge';

		$result = $wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO %i (event_participant_id, transaction_id, kind) VALUES (%d, %d, %s)',
				$this->get_table_name(),
				(int) $event_participant_id,
				(int) $transaction_id,
				$kind
			)
		);

		return false !== $result;
	}

	/**
	 * Net amount paid on a registration: SUM(charges) − SUM(refunds), counting
	 * only transactions marked paid in fair-payments-connector.
	 *
	 * @param int $event_participant_id Event participant row ID.
	 * @return float Net paid amount (>= 0 in practice).
	 */
	public function get_net_paid( $event_participant_id ) {
		global $wpdb;

		if ( ! $event_participant_id ) {
			return 0.0;
		}

		$transactions_table = $wpdb->prefix . 'fair_payment_transactions';

		$net = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COALESCE( SUM( CASE WHEN l.kind = 'refund' THEN -t.amount ELSE t.amount END ), 0 )
				 FROM %i l
				 INNER JOIN %i t ON l.transaction_id = t.id AND t.status = 'paid'
				 WHERE l.event_participant_id = %d",
				$this->get_table_name(),
				$transactions_table,
				(int) $event_participant_id
			)
		);

		return (float) $net;
	}

	/**
	 * Batched status lookup for a list of fair-payments-connector transaction
	 * IDs, keyed by transaction_id. Used to enrich rows that already carry a
	 * transaction_id (e.g. event_participant.transaction_id) without a
	 * per-row query. Returns an empty array when fair-payments-connector's
	 * table isn't present (plugin inactive).
	 *
	 * @param array $transaction_ids Transaction IDs to look up.
	 * @return array Associative array: transaction_id => status.
	 */
	public function get_statuses_by_transaction_ids( $transaction_ids ) {
		global $wpdb;

		if ( empty( $transaction_ids ) ) {
			return array();
		}

		$transactions_table = $wpdb->prefix . 'fair_payment_transactions';
		$placeholders       = implode( ',', array_fill( 0, count( $transaction_ids ), '%d' ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- $placeholders is safely constructed.
		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, status FROM %i WHERE id IN ($placeholders)",
				array_merge( array( $transactions_table ), array_map( 'intval', $transaction_ids ) )
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

		$statuses = array();
		foreach ( $results as $row ) {
			$statuses[ (int) $row['id'] ] = $row['status'];
		}

		return $statuses;
	}

	/**
	 * Reverse lookup: which registration(s) a transaction was charged against.
	 * Single indexed query on idx_transaction_id. Mirrors the batched
	 * get_statuses_by_transaction_ids() above.
	 *
	 * @param int $transaction_id fair-payments-connector transaction ID.
	 * @return int[] event_participant_id values (empty array when none match).
	 */
	public function get_event_participant_ids_by_transaction_id( $transaction_id ) {
		global $wpdb;

		if ( ! $transaction_id ) {
			return array();
		}

		$results = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT event_participant_id FROM %i WHERE transaction_id = %d AND kind = 'charge'",
				$this->get_table_name(),
				(int) $transaction_id
			)
		);

		return array_map( 'intval', $results );
	}

	/**
	 * Batched lookup of the latest charge transaction per registration, keyed
	 * by event_participant_id. Replaces the old single-value
	 * event_participant.transaction_id column now that a registration can
	 * accumulate multiple charges over time.
	 *
	 * @param array $event_participant_ids Event participant row IDs.
	 * @return array Associative array: event_participant_id => transaction_id.
	 */
	public function get_latest_charge_transaction_ids( $event_participant_ids ) {
		global $wpdb;

		if ( empty( $event_participant_ids ) ) {
			return array();
		}

		$placeholders = implode( ',', array_fill( 0, count( $event_participant_ids ), '%d' ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- $placeholders is safely constructed.
		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT event_participant_id, transaction_id, created_at FROM %i
				 WHERE event_participant_id IN ($placeholders) AND kind = 'charge'
				 ORDER BY created_at DESC",
				array_merge( array( $this->get_table_name() ), array_map( 'intval', $event_participant_ids ) )
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

		$latest = array();
		foreach ( $results as $row ) {
			$event_participant_id = (int) $row['event_participant_id'];
			if ( ! isset( $latest[ $event_participant_id ] ) ) {
				$latest[ $event_participant_id ] = (int) $row['transaction_id'];
			}
		}

		return $latest;
	}

	/**
	 * Full transaction history for a registration, newest first. Joins
	 * fair-payments-connector for status/amount/currency.
	 *
	 * @param int $event_participant_id Event participant row ID.
	 * @return array Array of ledger rows with joined transaction detail.
	 */
	public function get_by_event_participant( $event_participant_id ) {
		global $wpdb;

		$transactions_table = $wpdb->prefix . 'fair_payment_transactions';

		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT l.id, l.transaction_id, l.kind, l.created_at,
					t.status, t.amount, t.currency
				 FROM %i l
				 LEFT JOIN %i t ON l.transaction_id = t.id
				 WHERE l.event_participant_id = %d
				 ORDER BY l.created_at DESC',
				$this->get_table_name(),
				$transactions_table,
				(int) $event_participant_id
			),
			ARRAY_A
		);
	}
}
