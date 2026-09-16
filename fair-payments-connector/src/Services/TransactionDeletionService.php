<?php
/**
 * Transaction deletion service for Fair Payments Connector.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery -- atomic multi-table delete on custom tables; caching is not applicable.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Services;

defined( 'WPINC' ) || die;

use FairPaymentsConnector\Database\PaymentLogRepository;
use FairPaymentsConnector\Database\Schema;

/**
 * Atomically deletes a local transaction and its exclusively owned local data.
 *
 * Never contacts Mollie or any other payment provider — only local WordPress
 * data is touched. Owned rows (line items, the entry-transaction junction) are
 * deleted; independent rows that merely reference the transaction (financial
 * entries, payment log entries) are preserved but detached by clearing their
 * nullable transaction_id.
 */
class TransactionDeletionService {

	/**
	 * Delete a transaction and its owned local data in a single DB transaction.
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return bool True on success, false if the transaction does not exist or the deletion failed.
	 * @throws \RuntimeException Internally when any step of the delete fails; always caught below.
	 */
	public static function delete( $transaction_id ) {
		global $wpdb;

		$transaction_id = (int) $transaction_id;

		$transactions_table       = Schema::get_payments_table_name();
		$line_items_table         = Schema::get_line_items_table_name();
		$entry_transactions_table = Schema::get_entry_transactions_table_name();
		$financial_entries_table  = Schema::get_financial_entries_table_name();
		$log_table                = Schema::get_log_table_name();

		$wpdb->query( 'START TRANSACTION' );

		try {
			$transaction = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE id = %d FOR UPDATE',
					$transactions_table,
					$transaction_id
				)
			);

			if ( ! $transaction ) {
				throw new \RuntimeException( 'Transaction not found.' );
			}

			if ( false === $wpdb->delete( $line_items_table, array( 'transaction_id' => $transaction_id ), array( '%d' ) ) ) {
				throw new \RuntimeException( 'Could not delete line items.' );
			}

			if ( false === $wpdb->delete( $entry_transactions_table, array( 'transaction_id' => $transaction_id ), array( '%d' ) ) ) {
				throw new \RuntimeException( 'Could not unlink financial entries.' );
			}

			if ( false === $wpdb->update( $financial_entries_table, array( 'transaction_id' => null ), array( 'transaction_id' => $transaction_id ), array( '%d' ), array( '%d' ) ) ) {
				throw new \RuntimeException( 'Could not detach financial entries.' );
			}

			if ( false === $wpdb->update( $log_table, array( 'transaction_id' => null ), array( 'transaction_id' => $transaction_id ), array( '%d' ), array( '%d' ) ) ) {
				throw new \RuntimeException( 'Could not detach payment log entries.' );
			}

			if ( false === $wpdb->delete( $transactions_table, array( 'id' => $transaction_id ), array( '%d' ) ) ) {
				throw new \RuntimeException( 'Could not delete the transaction.' );
			}

			$wpdb->query( 'COMMIT' );
		} catch ( \Throwable $error ) {
			$wpdb->query( 'ROLLBACK' );

			if ( ! empty( $transaction ) ) {
				( new PaymentLogRepository() )->log(
					'transaction_delete_failed',
					array(
						'transaction_id' => $transaction_id,
						'level'          => 'error',
						'message'        => $error->getMessage(),
						'context'        => array(
							'mollie_payment_id' => $transaction->mollie_payment_id,
						),
					)
				);
			}

			return false;
		}

		( new PaymentLogRepository() )->log(
			'transaction_deleted',
			array(
				'transaction_id' => null,
				'level'          => 'info',
				'message'        => sprintf( 'Transaction #%d deleted.', $transaction_id ),
				'context'        => array(
					'deleted_transaction_id' => $transaction_id,
					'mollie_payment_id'      => $transaction->mollie_payment_id,
				),
			)
		);

		return true;
	}
}
