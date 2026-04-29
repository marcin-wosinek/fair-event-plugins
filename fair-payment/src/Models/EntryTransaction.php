<?php
/**
 * EntryTransaction Model
 *
 * Junction table model for 1:many matching between financial entries and transactions.
 *
 * @package FairPayment
 */

namespace FairPayment\Models;

defined( 'WPINC' ) || die;

/**
 * Model class for entry-transaction links
 */
class EntryTransaction {
	/**
	 * Link a financial entry to a transaction
	 *
	 * @param int $entry_id       Financial entry ID.
	 * @param int $transaction_id Transaction ID.
	 * @return bool True on success, false on failure.
	 */
	public static function link( $entry_id, $transaction_id ) {
		global $wpdb;
		$table_name = self::get_table_name();

		// INSERT IGNORE to avoid duplicate key errors.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$result = $wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO %i (entry_id, transaction_id) VALUES (%d, %d)',
				$table_name,
				$entry_id,
				$transaction_id
			)
		);

		return false !== $result;
	}

	/**
	 * Unlink a specific transaction from a financial entry
	 *
	 * @param int $entry_id       Financial entry ID.
	 * @param int $transaction_id Transaction ID.
	 * @return bool True on success, false on failure.
	 */
	public static function unlink( $entry_id, $transaction_id ) {
		global $wpdb;
		$table_name = self::get_table_name();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$result = $wpdb->delete(
			$table_name,
			array(
				'entry_id'       => $entry_id,
				'transaction_id' => $transaction_id,
			),
			array( '%d', '%d' )
		);

		return false !== $result;
	}

	/**
	 * Remove all transaction links for a financial entry
	 *
	 * @param int $entry_id Financial entry ID.
	 * @return bool True on success, false on failure.
	 */
	public static function unlink_all_for_entry( $entry_id ) {
		global $wpdb;
		$table_name = self::get_table_name();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$result = $wpdb->delete(
			$table_name,
			array( 'entry_id' => $entry_id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Get all transaction IDs linked to a financial entry
	 *
	 * @param int $entry_id Financial entry ID.
	 * @return int[] Array of transaction IDs.
	 */
	public static function get_transaction_ids_for_entry( $entry_id ) {
		global $wpdb;
		$table_name = self::get_table_name();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$results = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT transaction_id FROM %i WHERE entry_id = %d ORDER BY id ASC',
				$table_name,
				$entry_id
			)
		);

		return array_map( 'intval', $results );
	}

	/**
	 * Get all entry IDs linked to a transaction
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return int[] Array of entry IDs.
	 */
	public static function get_entry_ids_for_transaction( $transaction_id ) {
		global $wpdb;
		$table_name = self::get_table_name();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$results = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT entry_id FROM %i WHERE transaction_id = %d ORDER BY id ASC',
				$table_name,
				$transaction_id
			)
		);

		return array_map( 'intval', $results );
	}

	/**
	 * Get entry IDs for multiple transactions in a single query.
	 *
	 * @param int[] $transaction_ids Array of transaction IDs.
	 * @return array Associative array of transaction_id => int[] entry IDs.
	 */
	public static function get_entry_ids_for_transactions( $transaction_ids ) {
		if ( empty( $transaction_ids ) ) {
			return array();
		}

		global $wpdb;
		$table_name = self::get_table_name();

		$placeholders = implode( ',', array_fill( 0, count( $transaction_ids ), '%d' ) );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- Dynamic placeholder count matches array size.
		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT transaction_id, entry_id FROM %i WHERE transaction_id IN ($placeholders) ORDER BY id ASC",
				array_merge( array( $table_name ), array_map( 'intval', $transaction_ids ) )
			)
		);

		$map = array();
		foreach ( $results as $row ) {
			$tid = (int) $row->transaction_id;
			if ( ! isset( $map[ $tid ] ) ) {
				$map[ $tid ] = array();
			}
			$map[ $tid ][] = (int) $row->entry_id;
		}

		return $map;
	}

	/**
	 * Check if a transaction is matched to any entry
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return bool True if matched.
	 */
	public static function is_transaction_matched( $transaction_id ) {
		global $wpdb;
		$table_name = self::get_table_name();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$count = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE transaction_id = %d',
				$table_name,
				$transaction_id
			)
		);

		return (int) $count > 0;
	}

	/**
	 * Get table name
	 *
	 * @return string Full table name with prefix.
	 */
	public static function get_table_name() {
		return \FairPayment\Database\Schema::get_entry_transactions_table_name();
	}
}
