<?php
/**
 * Fake $wpdb for TransactionDeletionService tests.
 *
 * @package FairPaymentsConnector
 */

/**
 * Fake $wpdb that records every delete/update/query call and can be told to
 * fail one specific table operation, without needing a real database.
 */
class Fair_Test_Transaction_Deletion_WPDB extends Fair_Test_WPDB {

	/**
	 * The transaction row returned by the service's initial SELECT ... FOR UPDATE.
	 *
	 * @var object|null
	 */
	public $transaction_row = null;

	/**
	 * Calls made against this fake, in order: [ 'delete'|'update'|'query'|'get_row', ...details ].
	 *
	 * @var array[]
	 */
	public $calls = array();

	/**
	 * When set to "delete:<table>" or "update:<table>", that call returns false.
	 *
	 * @var string|null
	 */
	public $fail_on = null;

	/**
	 * Stub of $wpdb->prepare() — returns the raw query, ignoring interpolation.
	 * The fake never executes real SQL, so exact substitution doesn't matter.
	 *
	 * @param string $query   Query with placeholders.
	 * @param mixed  ...$args Placeholder values.
	 * @return string
	 */
	public function prepare( $query, ...$args ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
		return $query;
	}

	/**
	 * Stub of $wpdb->get_row() — always returns the configured transaction row.
	 *
	 * @param string $query Prepared query (ignored).
	 * @return object|null
	 */
	public function get_row( $query ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
		$this->calls[] = array( 'get_row' );
		return $this->transaction_row;
	}

	/**
	 * Stub of $wpdb->delete().
	 *
	 * @param string $table        Table name.
	 * @param array  $where        WHERE clause data.
	 * @param array  $where_format Column formats.
	 * @return int|false
	 */
	public function delete( $table, $where, $where_format = null ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
		$this->calls[] = array( 'delete', $table, $where );
		if ( "delete:{$table}" === $this->fail_on ) {
			return false;
		}
		return 1;
	}

	/**
	 * Stub of $wpdb->update().
	 *
	 * @param string $table        Table name.
	 * @param array  $data         Column => value data.
	 * @param array  $where        WHERE clause data.
	 * @param array  $format       Column formats.
	 * @param array  $where_format WHERE column formats.
	 * @return int|false
	 */
	public function update( $table, $data, $where, $format = null, $where_format = null ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
		$this->calls[] = array( 'update', $table, $data, $where );
		if ( "update:{$table}" === $this->fail_on ) {
			return false;
		}
		return 1;
	}

	/**
	 * Stub of $wpdb->query() — used only for START TRANSACTION/COMMIT/ROLLBACK here.
	 *
	 * @param string $sql Raw SQL statement.
	 * @return true
	 */
	public function query( $sql ) {
		$this->calls[] = array( 'query', $sql );
		return true;
	}

	/**
	 * Names of tables touched by a delete() or update() call, in order.
	 *
	 * @param string $type 'delete' or 'update'.
	 * @return string[]
	 */
	public function tables_touched( $type ) {
		$tables = array();
		foreach ( $this->calls as $call ) {
			if ( $call[0] === $type ) {
				$tables[] = $call[1];
			}
		}
		return $tables;
	}
}
