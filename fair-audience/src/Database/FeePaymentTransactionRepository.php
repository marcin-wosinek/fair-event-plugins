<?php
/**
 * Fee Payment Transaction Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

defined( 'WPINC' ) || die;

/**
 * Repository for fee payment transaction attempts (junction table).
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class FeePaymentTransactionRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_fee_payment_transactions';
	}

	/**
	 * Record a transaction attempt for a fee payment.
	 *
	 * @param int $fee_payment_id Fee payment ID.
	 * @param int $transaction_id Transaction ID from fair-payment.
	 * @return bool Success.
	 */
	public function record_attempt( $fee_payment_id, $transaction_id ) {
		global $wpdb;

		$result = $wpdb->insert(
			$this->get_table_name(),
			array(
				'fee_payment_id' => $fee_payment_id,
				'transaction_id' => $transaction_id,
			),
			array( '%d', '%d' )
		);

		return false !== $result;
	}

	/**
	 * Get all transaction attempts for a fee payment.
	 *
	 * Joins with fair-payment transactions table to include status and amount details.
	 *
	 * @param int $fee_payment_id Fee payment ID.
	 * @return array Array of transaction attempt data.
	 */
	public function get_by_fee_payment_id( $fee_payment_id ) {
		global $wpdb;

		$table_name         = $this->get_table_name();
		$transactions_table = $wpdb->prefix . 'fair_payment_transactions';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT fpt.id, fpt.transaction_id, fpt.created_at,
					t.status, t.amount, t.currency, t.payment_initiated_at
				FROM %i fpt
				LEFT JOIN %i t ON fpt.transaction_id = t.id
				WHERE fpt.fee_payment_id = %d
				ORDER BY fpt.created_at DESC',
				$table_name,
				$transactions_table,
				$fee_payment_id
			),
			ARRAY_A
		);

		return $results;
	}
}
