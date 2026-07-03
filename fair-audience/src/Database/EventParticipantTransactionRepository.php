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
 * later upgrade charge, and, in the future, refunds. The event_participant row
 * only keeps the most recent transaction in its own transaction_id column, so
 * this table is the source of truth for payment history. Amounts and currency
 * are read by joining fair_payment_transactions (single source of truth),
 * mirroring FeePaymentTransactionRepository.
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
