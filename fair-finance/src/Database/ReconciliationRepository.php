<?php
/**
 * Finance-owned reconciliation persistence.
 *
 * @package FairFinance
 */

namespace FairFinance\Database;

use FairPaymentsConnector\Database\Schema as ConnectorSchema;

defined( 'WPINC' ) || die;

/**
 * Reads fresh rows; confirmation uses locking reads in one transaction.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ReconciliationRepository {
	/**
	 * A failed read must never masquerade as no conflicting matches.
	 *
	 * @param mixed $value Query result.
	 * @return mixed
	 * @throws \RuntimeException On SQL read failure.
	 */
	private function checked( $value ) {
		global $wpdb;
		if ( $wpdb->last_error ) {
			throw new \RuntimeException( 'Reconciliation read failed.' );
		}
		return $value;
	}

	/**
	 * Read Finance rows by a single indexed key.
	 *
	 * @param string $kind Table kind.
	 * @param string $key Column.
	 * @param int    $value ID.
	 * @param bool   $lock Lock rows.
	 * @return array
	 */
	public function rows( $kind, $key, $value, $lock = false ) {
		global $wpdb;
		$locking = $lock ? ' FOR UPDATE' : '';
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- fixed locking suffix and generated placeholders only.
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i WHERE %i = %d ORDER BY id ASC' . $locking, Schema::reconciliation_table( $kind ), $key, $value ), ARRAY_A );
		return $this->checked( $rows ) ?? array();
	}

	/**
	 * Current decision for a settlement.
	 *
	 * @param int  $id Settlement ID.
	 * @param bool $lock Lock row and unique-key gap.
	 * @return array|null
	 */
	public function decision( $id, $lock = false ) {
		return $this->rows( 'decisions', 'settlement_id', $id, $lock )[0] ?? null;
	}

	/**
	 * Explicit administrator context for a bank entry.
	 *
	 * @param int  $id Bank entry ID.
	 * @param bool $lock Lock row.
	 * @return array|null
	 */
	public function context( $id, $lock = false ) {
		global $wpdb;
		$locking = $lock ? ' FOR UPDATE' : '';
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- fixed locking suffix and generated placeholders only.
		return $this->checked( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE entry_id = %d' . $locking, Schema::reconciliation_table( 'context' ), $id ), ARRAY_A ) );
	}

	/**
	 * Bank entry and every existing allocation, as stored at two decimals.
	 *
	 * @param int  $id Bank entry ID.
	 * @param bool $lock Lock rows and allocation range.
	 * @return array
	 */
	public function bank( $id, $lock = false ) {
		global $wpdb;
		$locking = $lock ? ' FOR UPDATE' : '';
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- fixed locking suffix and generated placeholders only.
		return $this->checked( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d OR parent_entry_id = %d ORDER BY id ASC' . $locking, Schema::get_financial_entries_table_name(), $id, $id ), ARRAY_A ) ) ?? array();
	}

	/**
	 * Resolve references in batches, preserving ambiguity and exact case.
	 *
	 * @param array $references Provider references.
	 * @param bool  $lock Lock matches and reference gaps.
	 * @return array
	 */
	public function transactions( array $references, $lock = false ) {
		global $wpdb;
		$locking = $lock ? ' FOR UPDATE' : '';
		$rows    = array();
		foreach ( array_chunk( array_values( array_unique( $references ) ), 200 ) as $batch ) {
			$placeholders = implode( ',', array_fill( 0, count( $batch ), '%s' ) );
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- fixed locking suffix and generated placeholders only.
			$found = $wpdb->get_results( $wpdb->prepare( "SELECT id, mollie_payment_id, amount, currency, application_fee, mollie_fee, status, testmode, description, event_date_id, metadata FROM %i WHERE mollie_payment_id IN ($placeholders) ORDER BY id ASC" . $locking, array_merge( array( ConnectorSchema::get_payments_table_name() ), $batch ) ), ARRAY_A );
			foreach ( $this->checked( $found ) ?? array() as $row ) {
				if ( in_array( $row['mollie_payment_id'], $batch, true ) ) {
					$rows[] = $row;
				}
			}
		}
		return $rows;
	}

	/**
	 * Existing links touching a bank entry or a resolved transaction.
	 *
	 * @param array $ids Transaction IDs.
	 * @param int   $entry_id Bank entry ID.
	 * @param bool  $lock Lock link ranges.
	 * @return array
	 */
	public function links( array $ids, $entry_id, $lock = false ) {
		global $wpdb;
		$locking      = $lock ? ' FOR UPDATE' : '';
		$ids          = $ids ? $ids : array( 0 );
		$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- fixed locking suffix and generated placeholders only.
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- fixed locking suffix and generated placeholders only.
		return $this->checked( $wpdb->get_results( $wpdb->prepare( "SELECT entry_id, transaction_id FROM %i WHERE entry_id = %d OR transaction_id IN ($placeholders) ORDER BY entry_id, transaction_id" . $locking, array_merge( array( ConnectorSchema::get_entry_transactions_table_name(), $entry_id ), $ids ) ), ARRAY_A ) ) ?? array();
	}

	/**
	 * Search eligible bank entries without a first-page cutoff.
	 *
	 * @param int $settlement_id Current settlement.
	 * @param int $page Page number.
	 * @return array
	 */
	public function candidates( $settlement_id, $page ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- fixed locking suffix and generated placeholders only.
		return $this->checked( $wpdb->get_results( $wpdb->prepare( 'SELECT e.*, c.account_id AS context_account_id, c.currency AS context_currency FROM %i e LEFT JOIN %i c ON c.entry_id = e.id WHERE e.parent_entry_id IS NULL AND e.entry_type = %s AND NOT EXISTS (SELECT 1 FROM %i d WHERE d.entry_id = e.id AND d.settlement_id <> %d) ORDER BY e.id ASC LIMIT 100 OFFSET %d', Schema::get_financial_entries_table_name(), Schema::reconciliation_table( 'context' ), 'income', Schema::reconciliation_table( 'decisions' ), $settlement_id, ( max( 1, $page ) - 1 ) * 100 ), ARRAY_A ) ) ?? array();
	}

	/**
	 * Current movement evidence in other payouts of the same provider account.
	 * The shared provider write lock serializes membership checks/confirmation.
	 *
	 * @param int $account_id Provider account.
	 * @param int $settlement_id Settlement under review.
	 * @return array
	 */
	public function memberships( $account_id, $settlement_id ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- fixed locking suffix and generated placeholders only.
		return $this->checked(
			$wpdb->get_results(
				$wpdb->prepare(
					'SELECT DISTINCT e.movement_key, d.settlement_id FROM %i e INNER JOIN %i d ON d.history_id = e.history_id INNER JOIN %i s ON s.id = d.settlement_id WHERE s.account_id = %d AND d.settlement_id <> %d ORDER BY e.movement_key, d.settlement_id',
					Schema::reconciliation_table( 'evidence' ),
					Schema::reconciliation_table( 'decisions' ),
					ConnectorSchema::get_settlements_table_name(),
					$account_id,
					$settlement_id
				),
				ARRAY_A
			)
		) ?? array();
	}

	/**
	 * Fail atomically on any persistence error.
	 *
	 * @param string     $kind Table kind.
	 * @param array      $data Columns.
	 * @param array|null $where Update key; null inserts.
	 * @return int Inserted ID or affected rows.
	 * @throws \RuntimeException On database error.
	 */
	public function save( $kind, array $data, ?array $where = null ) {
		global $wpdb;
		$result = null === $where ? $wpdb->insert( Schema::reconciliation_table( $kind ), $data ) : $wpdb->update( Schema::reconciliation_table( $kind ), $data, $where );
		if ( false === $result ) {
			throw new \RuntimeException( 'Reconciliation write failed.' );
		}
		return null === $where ? (int) $wpdb->insert_id : (int) $result;
	}
}
