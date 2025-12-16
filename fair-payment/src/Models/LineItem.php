<?php
/**
 * LineItem Model
 *
 * @package FairPayment
 */

namespace FairPayment\Models;

defined( 'WPINC' ) || die;

/**
 * Model class for line items
 */
class LineItem {
	/**
	 * Create line items for a transaction
	 *
	 * @param int   $transaction_id Transaction ID.
	 * @param array $items Array of line item data.
	 * @return bool True on success, false on failure.
	 */
	public static function create_for_transaction( $transaction_id, $items ) {
		global $wpdb;
		$table_name = self::get_table_name();

		$sort_order = 0;

		foreach ( $items as $item ) {
			$quantity     = isset( $item['quantity'] ) ? absint( $item['quantity'] ) : 1;
			$unit_amount  = (float) $item['amount'];
			$total_amount = $quantity * $unit_amount;

			$inserted = $wpdb->insert(
				$table_name,
				array(
					'transaction_id' => $transaction_id,
					'name'           => $item['name'],
					'description'    => isset( $item['description'] ) ? $item['description'] : null,
					'quantity'       => $quantity,
					'unit_amount'    => $unit_amount,
					'total_amount'   => $total_amount,
					'sort_order'     => $sort_order++,
				),
				array( '%d', '%s', '%s', '%d', '%f', '%f', '%d' )
			);

			if ( false === $inserted ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Get line items for a transaction
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return array Array of line item objects.
	 */
	public static function get_by_transaction_id( $transaction_id ) {
		global $wpdb;
		$table_name = self::get_table_name();

		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE transaction_id = %d ORDER BY sort_order ASC',
				$table_name,
				$transaction_id
			)
		);
	}

	/**
	 * Delete line items for a transaction
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_by_transaction_id( $transaction_id ) {
		global $wpdb;
		$table_name = self::get_table_name();

		return (bool) $wpdb->delete(
			$table_name,
			array( 'transaction_id' => $transaction_id ),
			array( '%d' )
		);
	}

	/**
	 * Get table name
	 *
	 * @return string Full table name with prefix.
	 */
	public static function get_table_name() {
		return \FairPayment\Database\Schema::get_line_items_table_name();
	}
}
