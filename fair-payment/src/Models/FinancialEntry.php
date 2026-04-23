<?php
/**
 * Financial Entry model for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Models;

use FairPayment\Database\Schema;

defined( 'WPINC' ) || die;

/**
 * Financial Entry model class
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class FinancialEntry {

	/**
	 * Entry ID
	 *
	 * @var int
	 */
	public $id;

	/**
	 * Amount (positive value)
	 *
	 * @var float
	 */
	public $amount;

	/**
	 * Entry type: 'cost', 'income', or 'transfer'
	 *
	 * @var string
	 */
	public $entry_type;

	/**
	 * Entry date
	 *
	 * @var string
	 */
	public $entry_date;

	/**
	 * Description
	 *
	 * @var string|null
	 */
	public $description;

	/**
	 * Budget ID (foreign key)
	 *
	 * @var int|null
	 */
	public $budget_id;

	/**
	 * Transaction ID (legacy 1:1 match, kept for backward compatibility)
	 *
	 * @var int|null
	 */
	public $transaction_id;

	/**
	 * Transaction IDs (from junction table, supports 1:many matching)
	 *
	 * @var int[]
	 */
	public $transaction_ids = array();

	/**
	 * External reference for deduplication (e.g., from imported data)
	 *
	 * @var string|null
	 */
	public $external_reference;

	/**
	 * Parent entry ID (for split entries)
	 *
	 * @var int|null
	 */
	public $parent_entry_id;

	/**
	 * Event URL (link to local or external event)
	 *
	 * @var string|null
	 */
	public $event_url;

	/**
	 * Event date ID (foreign key to fair_event_dates table)
	 *
	 * @var int|null
	 */
	public $event_date_id;

	/**
	 * Participant ID (foreign key to fair_audience_participants table)
	 *
	 * @var int|null
	 */
	public $participant_id;

	/**
	 * Import source filename
	 *
	 * @var string|null
	 */
	public $import_source;

	/**
	 * Imported at timestamp
	 *
	 * @var string|null
	 */
	public $imported_at;

	/**
	 * Created at timestamp
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Updated at timestamp
	 *
	 * @var string
	 */
	public $updated_at;

	/**
	 * Get table name
	 *
	 * @return string Table name with prefix.
	 */
	private static function get_table_name() {
		return Schema::get_financial_entries_table_name();
	}

	/**
	 * Get entry by ID
	 *
	 * @param int $id Entry ID.
	 * @return FinancialEntry|null Entry object or null if not found.
	 */
	public static function get_by_id( $id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d LIMIT 1',
				$table_name,
				$id
			)
		);

		if ( ! $result ) {
			return null;
		}

		return self::hydrate( $result );
	}

	/**
	 * Get all entries
	 *
	 * @param string $order_by Column to order by (default 'entry_date').
	 * @param string $order    Order direction ASC or DESC (default 'DESC').
	 * @return FinancialEntry[] Array of FinancialEntry objects.
	 */
	public static function get_all( $order_by = 'entry_date', $order = 'DESC' ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Validate order_by to prevent SQL injection.
		$allowed_columns = array( 'id', 'amount', 'entry_type', 'entry_date', 'budget_id', 'transaction_id', 'created_at', 'updated_at' );
		if ( ! in_array( $order_by, $allowed_columns, true ) ) {
			$order_by = 'entry_date';
		}

		// Validate order direction.
		$order = strtoupper( $order ) === 'ASC' ? 'ASC' : 'DESC';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i ORDER BY %i ' . $order . ', id DESC', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$table_name,
				$order_by
			)
		);

		if ( ! $results ) {
			return array();
		}

		$entries = array();
		foreach ( $results as $result ) {
			$entries[] = self::hydrate( $result );
		}

		return $entries;
	}

	/**
	 * Get filtered entries with pagination
	 *
	 * @param array $filters {
	 *     Optional. Filter parameters.
	 *
	 *     @type string $date_from   Start date (Y-m-d format).
	 *     @type string $date_to     End date (Y-m-d format).
	 *     @type int    $budget_id   Filter by budget ID.
	 *     @type string $entry_type  Filter by type: 'cost' or 'income'.
	 *     @type bool   $unmatched   If true, only return entries without transaction_id.
	 *     @type int    $per_page    Items per page (default 50).
	 *     @type int    $page        Page number (default 1).
	 * }
	 * @return array {
	 *     @type FinancialEntry[] $entries Array of entries.
	 *     @type int              $total   Total count of matching entries.
	 *     @type int              $pages   Total number of pages.
	 * }
	 */
	public static function get_filtered( $filters = array() ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$defaults = array(
			'date_from'     => null,
			'date_to'       => null,
			'budget_id'     => null,
			'event_url'     => null,
			'event_date_id' => null,
			'entry_type'    => null,
			'unmatched'     => false,
			'per_page'      => 50,
			'page'          => 1,
		);

		$filters = wp_parse_args( $filters, $defaults );

		// Build WHERE clause.
		$where_clauses = array();
		$where_values  = array();

		// When filtering by a specific budget, event_url, or event_date_id, include child entries matching that filter.
		// Otherwise, exclude child entries (they are shown under their parent).
		if ( ( ! empty( $filters['budget_id'] ) && 'none' !== $filters['budget_id'] ) || ! empty( $filters['event_url'] ) || ! empty( $filters['event_date_id'] ) ) {
			// No parent_entry_id restriction — filter will match both parents and children.
		} else {
			$where_clauses[] = 'parent_entry_id IS NULL';
		}

		if ( ! empty( $filters['date_from'] ) ) {
			$where_clauses[] = 'entry_date >= %s';
			$where_values[]  = $filters['date_from'];
		}

		if ( ! empty( $filters['date_to'] ) ) {
			$where_clauses[] = 'entry_date <= %s';
			$where_values[]  = $filters['date_to'];
		}

		if ( ! empty( $filters['budget_id'] ) ) {
			if ( 'none' === $filters['budget_id'] ) {
				$where_clauses[] = 'budget_id IS NULL';
			} else {
				$where_clauses[] = 'budget_id = %d';
				$where_values[]  = (int) $filters['budget_id'];
			}
		}

		if ( ! empty( $filters['event_url'] ) ) {
			$where_clauses[] = 'event_url = %s';
			$where_values[]  = $filters['event_url'];
		}

		if ( ! empty( $filters['event_date_id'] ) ) {
			$where_clauses[] = 'event_date_id = %d';
			$where_values[]  = (int) $filters['event_date_id'];
		}

		if ( ! empty( $filters['entry_type'] ) && in_array( $filters['entry_type'], array( 'cost', 'income', 'transfer' ), true ) ) {
			$where_clauses[] = 'entry_type = %s';
			$where_values[]  = $filters['entry_type'];
		}

		if ( ! empty( $filters['unmatched'] ) ) {
			$junction_table  = Schema::get_entry_transactions_table_name();
			$where_clauses[] = $wpdb->prepare(
				'NOT EXISTS (SELECT 1 FROM %i WHERE entry_id = ' . $table_name . '.id)',
				$junction_table
			);
		}

		$where_sql = '';
		if ( ! empty( $where_clauses ) ) {
			$where_sql = 'WHERE ' . implode( ' AND ', $where_clauses );
		}

		// Get total count.
		$count_sql = $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table_name );
		if ( ! empty( $where_values ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$count_sql .= ' ' . $wpdb->prepare( str_replace( '%i', '%%i', $where_sql ), ...$where_values );
		} elseif ( ! empty( $where_sql ) ) {
			$count_sql .= ' ' . $where_sql;
		}

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$total = (int) $wpdb->get_var( $count_sql );

		// Calculate pagination.
		$per_page = max( 1, (int) $filters['per_page'] );
		$page     = max( 1, (int) $filters['page'] );
		$offset   = ( $page - 1 ) * $per_page;
		$pages    = ceil( $total / $per_page );

		// Get entries.
		$query = $wpdb->prepare( 'SELECT * FROM %i', $table_name );
		if ( ! empty( $where_values ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$query .= ' ' . $wpdb->prepare( str_replace( '%i', '%%i', $where_sql ), ...$where_values );
		} elseif ( ! empty( $where_sql ) ) {
			$query .= ' ' . $where_sql;
		}
		$allowed_orderby = array( 'entry_date', 'amount', 'budget_id', 'imported_at' );
		$orderby         = ! empty( $filters['orderby'] ) && in_array( $filters['orderby'], $allowed_orderby, true )
			? $filters['orderby']
			: 'entry_date';
		$order           = ! empty( $filters['order'] ) && 'asc' === strtolower( $filters['order'] ) ? 'ASC' : 'DESC';

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$query .= $wpdb->prepare( " ORDER BY %i $order, id DESC LIMIT %d OFFSET %d", $orderby, $per_page, $offset );

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$results = $wpdb->get_results( $query );

		$entries = array();
		if ( $results ) {
			foreach ( $results as $result ) {
				$entries[] = self::hydrate( $result );
			}
		}

		return array(
			'entries' => $entries,
			'total'   => $total,
			'pages'   => (int) $pages,
		);
	}

	/**
	 * Get totals (sum of costs, income, and balance)
	 *
	 * @param array $filters Same filters as get_filtered (excluding pagination).
	 * @return array {
	 *     @type float $total_cost   Sum of all costs.
	 *     @type float $total_income Sum of all income.
	 *     @type float $balance      Income minus costs.
	 * }
	 */
	public static function get_totals( $filters = array() ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Build WHERE clause (same as get_filtered but without pagination).
		// Exclude parent entries that have children (to avoid double-counting).
		$where_clauses = array();
		$where_values  = array();

		// Exclude entries that are parents (have children). Count children instead.
		$where_clauses[] = 'id NOT IN (SELECT DISTINCT parent_entry_id FROM ' . $table_name . ' WHERE parent_entry_id IS NOT NULL)';

		if ( ! empty( $filters['date_from'] ) ) {
			$where_clauses[] = 'entry_date >= %s';
			$where_values[]  = $filters['date_from'];
		}

		if ( ! empty( $filters['date_to'] ) ) {
			$where_clauses[] = 'entry_date <= %s';
			$where_values[]  = $filters['date_to'];
		}

		if ( ! empty( $filters['budget_id'] ) ) {
			if ( 'none' === $filters['budget_id'] ) {
				$where_clauses[] = 'budget_id IS NULL';
			} else {
				$where_clauses[] = 'budget_id = %d';
				$where_values[]  = (int) $filters['budget_id'];
			}
		}

		if ( ! empty( $filters['event_url'] ) ) {
			$where_clauses[] = 'event_url = %s';
			$where_values[]  = $filters['event_url'];
		}

		if ( ! empty( $filters['event_date_id'] ) ) {
			$where_clauses[] = 'event_date_id = %d';
			$where_values[]  = (int) $filters['event_date_id'];
		}

		if ( ! empty( $filters['unmatched'] ) ) {
			$junction_table  = Schema::get_entry_transactions_table_name();
			$where_clauses[] = $wpdb->prepare(
				'NOT EXISTS (SELECT 1 FROM %i WHERE entry_id = ' . $table_name . '.id)',
				$junction_table
			);
		}

		$where_sql = '';
		if ( ! empty( $where_clauses ) ) {
			$where_sql = 'WHERE ' . implode( ' AND ', $where_clauses );
		}

		// Get cost total.
		$cost_sql = $wpdb->prepare( 'SELECT COALESCE(SUM(amount), 0) FROM %i', $table_name );
		if ( ! empty( $where_values ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$cost_where = $wpdb->prepare( str_replace( '%i', '%%i', $where_sql ), ...$where_values );
			$cost_sql  .= ' ' . $cost_where . " AND entry_type = 'cost'";
		} elseif ( ! empty( $where_sql ) ) {
			$cost_sql .= ' ' . $where_sql . " AND entry_type = 'cost'";
		} else {
			$cost_sql .= " WHERE entry_type = 'cost'";
		}
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$total_cost = (float) $wpdb->get_var( $cost_sql );

		// Get income total.
		$income_sql = $wpdb->prepare( 'SELECT COALESCE(SUM(amount), 0) FROM %i', $table_name );
		if ( ! empty( $where_values ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$income_where = $wpdb->prepare( str_replace( '%i', '%%i', $where_sql ), ...$where_values );
			$income_sql  .= ' ' . $income_where . " AND entry_type = 'income'";
		} elseif ( ! empty( $where_sql ) ) {
			$income_sql .= ' ' . $where_sql . " AND entry_type = 'income'";
		} else {
			$income_sql .= " WHERE entry_type = 'income'";
		}
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$total_income = (float) $wpdb->get_var( $income_sql );

		return array(
			'total_cost'   => $total_cost,
			'total_income' => $total_income,
			'balance'      => $total_income - $total_cost,
		);
	}

	/**
	 * Get totals grouped by budget
	 *
	 * @return array Array with budget_id as key and totals as value.
	 */
	public static function get_totals_by_budget() {
		global $wpdb;

		$table_name = self::get_table_name();

		// Get totals grouped by budget_id and entry_type.
		// Exclude parent entries that have children (to avoid double-counting).
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT budget_id, entry_type, SUM(amount) as total, COUNT(*) as count FROM %i WHERE id NOT IN (SELECT DISTINCT parent_entry_id FROM %i WHERE parent_entry_id IS NOT NULL) GROUP BY budget_id, entry_type',
				$table_name,
				$table_name
			)
		);

		$stats = array();

		foreach ( $results as $row ) {
			$budget_key = null === $row->budget_id ? 'unbudgeted' : (int) $row->budget_id;

			if ( ! isset( $stats[ $budget_key ] ) ) {
				$stats[ $budget_key ] = array(
					'total_cost'   => 0.0,
					'total_income' => 0.0,
					'cost_count'   => 0,
					'income_count' => 0,
				);
			}

			if ( 'cost' === $row->entry_type ) {
				$stats[ $budget_key ]['total_cost'] = (float) $row->total;
				$stats[ $budget_key ]['cost_count'] = (int) $row->count;
			} else {
				$stats[ $budget_key ]['total_income'] = (float) $row->total;
				$stats[ $budget_key ]['income_count'] = (int) $row->count;
			}
		}

		// Calculate balance for each.
		foreach ( $stats as $key => $data ) {
			$stats[ $key ]['balance']     = $data['total_income'] - $data['total_cost'];
			$stats[ $key ]['total_count'] = $data['cost_count'] + $data['income_count'];
		}

		return $stats;
	}

	/**
	 * Create a new financial entry
	 *
	 * @param float       $amount         Entry amount (positive value).
	 * @param string      $entry_type     Entry type: 'cost' or 'income'.
	 * @param string      $entry_date     Entry date (Y-m-d format).
	 * @param string|null $description    Entry description.
	 * @param int|null    $budget_id      Budget ID.
	 * @param int|null    $transaction_id Transaction ID.
	 * @return int|false The entry ID on success, false on failure.
	 */
	public static function create( $amount, $entry_type, $entry_date, $description = null, $budget_id = null, $transaction_id = null, $event_url = null, $event_date_id = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Validate entry_type.
		if ( ! in_array( $entry_type, array( 'cost', 'income', 'transfer' ), true ) ) {
			return false;
		}

		$data = array(
			'amount'         => abs( (float) $amount ),
			'entry_type'     => $entry_type,
			'entry_date'     => $entry_date,
			'description'    => $description,
			'budget_id'      => $budget_id ? (int) $budget_id : null,
			'transaction_id' => $transaction_id ? (int) $transaction_id : null,
			'event_url'      => $event_url ? $event_url : null,
			'event_date_id'  => $event_date_id ? (int) $event_date_id : null,
		);

		$format = array( '%f', '%s', '%s', '%s', '%d', '%d', '%s', '%d' );

		$result = $wpdb->insert( $table_name, $data, $format );

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Update a financial entry
	 *
	 * @param int         $id             Entry ID.
	 * @param float       $amount         Entry amount (positive value).
	 * @param string      $entry_type     Entry type: 'cost' or 'income'.
	 * @param string      $entry_date     Entry date (Y-m-d format).
	 * @param string|null $description    Entry description.
	 * @param int|null    $budget_id      Budget ID.
	 * @param int|null    $transaction_id Transaction ID.
	 * @return bool True on success, false on failure.
	 */
	public static function update( $id, $amount, $entry_type, $entry_date, $description = null, $budget_id = null, $transaction_id = null, $event_url = null, $event_date_id = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Validate entry_type.
		if ( ! in_array( $entry_type, array( 'cost', 'income', 'transfer' ), true ) ) {
			return false;
		}

		$data = array(
			'amount'         => abs( (float) $amount ),
			'entry_type'     => $entry_type,
			'entry_date'     => $entry_date,
			'description'    => $description,
			'budget_id'      => $budget_id ? (int) $budget_id : null,
			'transaction_id' => $transaction_id ? (int) $transaction_id : null,
			'event_url'      => $event_url ? $event_url : null,
			'event_date_id'  => $event_date_id ? (int) $event_date_id : null,
		);

		$format = array( '%f', '%s', '%s', '%s', '%d', '%d', '%s', '%d' );

		$result = $wpdb->update(
			$table_name,
			$data,
			array( 'id' => $id ),
			$format,
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Delete a financial entry
	 *
	 * @param int $id Entry ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete( $id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Cascade delete children before parent.
		$wpdb->delete(
			$table_name,
			array( 'parent_entry_id' => $id ),
			array( '%d' )
		);

		$result = $wpdb->delete(
			$table_name,
			array( 'id' => $id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Match entry to a transaction
	 *
	 * @param int $id             Entry ID.
	 * @param int $transaction_id Transaction ID.
	 * @return bool True on success, false on failure.
	 */
	public static function match_transaction( $id, $transaction_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Write to junction table (source of truth).
		EntryTransaction::link( $id, $transaction_id );

		// Also update legacy column for backward compatibility.
		$result = $wpdb->update(
			$table_name,
			array( 'transaction_id' => (int) $transaction_id ),
			array( 'id' => $id ),
			array( '%d' ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Match entry to multiple transactions
	 *
	 * @param int   $id              Entry ID.
	 * @param int[] $transaction_ids Array of transaction IDs.
	 * @return bool True on success, false on failure.
	 */
	public static function match_transactions( $id, $transaction_ids ) {
		foreach ( $transaction_ids as $transaction_id ) {
			EntryTransaction::link( $id, (int) $transaction_id );
		}

		// Update legacy column with the first transaction ID.
		if ( ! empty( $transaction_ids ) ) {
			global $wpdb;
			$table_name = self::get_table_name();

			$wpdb->update(
				$table_name,
				array( 'transaction_id' => (int) $transaction_ids[0] ),
				array( 'id' => $id ),
				array( '%d' ),
				array( '%d' )
			);
		}

		return true;
	}

	/**
	 * Unmatch entry from all transactions
	 *
	 * @param int $id Entry ID.
	 * @return bool True on success, false on failure.
	 */
	public static function unmatch_transaction( $id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Clear junction table.
		EntryTransaction::unlink_all_for_entry( $id );

		// Clear legacy column.
		$result = $wpdb->update(
			$table_name,
			array( 'transaction_id' => null ),
			array( 'id' => $id ),
			array( '%d' ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Unmatch a single transaction from an entry
	 *
	 * @param int $id             Entry ID.
	 * @param int $transaction_id Transaction ID to unlink.
	 * @return bool True on success, false on failure.
	 */
	public static function unmatch_single_transaction( $id, $transaction_id ) {
		EntryTransaction::unlink( $id, $transaction_id );

		// Update legacy column: set to first remaining linked transaction or null.
		$remaining = EntryTransaction::get_transaction_ids_for_entry( $id );

		global $wpdb;
		$table_name = self::get_table_name();

		$wpdb->update(
			$table_name,
			array( 'transaction_id' => ! empty( $remaining ) ? $remaining[0] : null ),
			array( 'id' => $id ),
			array( '%d' ),
			array( '%d' )
		);

		return true;
	}

	/**
	 * Check if an external reference already exists
	 *
	 * @param string $external_reference The external reference to check.
	 * @return bool True if exists, false otherwise.
	 */
	public static function external_reference_exists( $external_reference ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE external_reference = %s',
				$table_name,
				$external_reference
			)
		);

		return (int) $result > 0;
	}

	/**
	 * Create an entry with external reference (for imports)
	 *
	 * @param float       $amount             Entry amount (positive value).
	 * @param string      $entry_type         Entry type: 'cost' or 'income'.
	 * @param string      $entry_date         Entry date (Y-m-d format).
	 * @param string      $external_reference External reference for deduplication.
	 * @param string|null $description        Entry description.
	 * @param int|null    $budget_id          Budget ID.
	 * @param string|null $import_source      Import source filename.
	 * @return int|false The entry ID on success, false on failure.
	 */
	public static function create_with_external_reference( $amount, $entry_type, $entry_date, $external_reference, $description = null, $budget_id = null, $import_source = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Validate entry_type.
		if ( ! in_array( $entry_type, array( 'cost', 'income' ), true ) ) {
			return false;
		}

		// Check if external reference already exists.
		if ( self::external_reference_exists( $external_reference ) ) {
			return false;
		}

		$data = array(
			'amount'             => abs( (float) $amount ),
			'entry_type'         => $entry_type,
			'entry_date'         => $entry_date,
			'description'        => $description,
			'budget_id'          => $budget_id ? (int) $budget_id : null,
			'external_reference' => $external_reference,
			'import_source'      => $import_source,
			'imported_at'        => current_time( 'mysql' ),
		);

		$format = array( '%f', '%s', '%s', '%s', '%d', '%s', '%s', '%s' );

		$result = $wpdb->insert( $table_name, $data, $format );

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Get child entries for a parent entry
	 *
	 * @param int $parent_id Parent entry ID.
	 * @return FinancialEntry[] Array of child entries.
	 */
	public static function get_children( $parent_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE parent_entry_id = %d ORDER BY id ASC',
				$table_name,
				$parent_id
			)
		);

		if ( ! $results ) {
			return array();
		}

		$entries = array();
		foreach ( $results as $result ) {
			$entries[] = self::hydrate( $result );
		}

		return $entries;
	}

	/**
	 * Check if an entry has children (is a split parent)
	 *
	 * @param int $id Entry ID.
	 * @return bool True if entry has children.
	 */
	public static function has_children( $id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$count = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE parent_entry_id = %d',
				$table_name,
				$id
			)
		);

		return (int) $count > 0;
	}

	/**
	 * Split an entry into multiple budget allocations
	 *
	 * @param int   $id          Entry ID to split.
	 * @param array $allocations Array of allocations, each with budget_id, amount, description.
	 * @return int[]|false Array of new child entry IDs on success, false on failure.
	 */
	public static function split_entry( $id, $allocations ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Validate the entry exists.
		$entry = self::get_by_id( $id );
		if ( ! $entry ) {
			return false;
		}

		// Cannot split a child entry.
		if ( $entry->parent_entry_id ) {
			return false;
		}

		// Cannot split an already-split entry.
		if ( self::has_children( $id ) ) {
			return false;
		}

		// Start transaction.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query( 'START TRANSACTION' );

		// Clear budget, event_url, and event_date_id on parent — they are now on the children.
		$wpdb->update(
			$table_name,
			array(
				'budget_id'     => null,
				'event_url'     => null,
				'event_date_id' => null,
			),
			array( 'id' => $id ),
			array( '%d', '%s', '%d' ),
			array( '%d' )
		);

		$child_ids = array();

		foreach ( $allocations as $allocation ) {
			$data = array(
				'amount'          => abs( (float) $allocation['amount'] ),
				'entry_type'      => $entry->entry_type,
				'entry_date'      => $entry->entry_date,
				'description'     => isset( $allocation['description'] ) ? $allocation['description'] : $entry->description,
				'budget_id'       => ! empty( $allocation['budget_id'] ) ? (int) $allocation['budget_id'] : null,
				'transaction_id'  => $entry->transaction_id,
				'parent_entry_id' => $id,
				'event_url'       => ! empty( $allocation['event_url'] ) ? $allocation['event_url'] : null,
				'event_date_id'   => ! empty( $allocation['event_date_id'] ) ? (int) $allocation['event_date_id'] : null,
			);

			$format = array( '%f', '%s', '%s', '%s', '%d', '%d', '%d', '%s', '%d' );

			$result = $wpdb->insert( $table_name, $data, $format );

			if ( ! $result ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$wpdb->query( 'ROLLBACK' );
				return false;
			}

			$child_ids[] = $wpdb->insert_id;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query( 'COMMIT' );

		return $child_ids;
	}

	/**
	 * Update an existing split by replacing all children atomically
	 *
	 * @param int   $id          Parent entry ID.
	 * @param array $allocations Array of allocations, each with budget_id, amount, description.
	 * @return int[]|false Array of new child entry IDs on success, false on failure.
	 */
	public static function update_split( $id, $allocations ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Validate the entry exists.
		$entry = self::get_by_id( $id );
		if ( ! $entry ) {
			return false;
		}

		// Must already be split.
		if ( ! self::has_children( $id ) ) {
			return false;
		}

		// Start transaction.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query( 'START TRANSACTION' );

		// Ensure parent has no budget, event_url, or event_date_id — they are on the children.
		$wpdb->update(
			$table_name,
			array(
				'budget_id'     => null,
				'event_url'     => null,
				'event_date_id' => null,
			),
			array( 'id' => $id ),
			array( '%d', '%s', '%d' ),
			array( '%d' )
		);

		// Delete existing children.
		$delete_result = $wpdb->delete(
			$table_name,
			array( 'parent_entry_id' => $id ),
			array( '%d' )
		);

		if ( false === $delete_result ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( 'ROLLBACK' );
			return false;
		}

		// Create new children.
		$child_ids = array();

		foreach ( $allocations as $allocation ) {
			$data = array(
				'amount'          => abs( (float) $allocation['amount'] ),
				'entry_type'      => $entry->entry_type,
				'entry_date'      => $entry->entry_date,
				'description'     => isset( $allocation['description'] ) ? $allocation['description'] : $entry->description,
				'budget_id'       => ! empty( $allocation['budget_id'] ) ? (int) $allocation['budget_id'] : null,
				'transaction_id'  => $entry->transaction_id,
				'parent_entry_id' => $id,
				'event_url'       => ! empty( $allocation['event_url'] ) ? $allocation['event_url'] : null,
				'event_date_id'   => ! empty( $allocation['event_date_id'] ) ? (int) $allocation['event_date_id'] : null,
			);

			$format = array( '%f', '%s', '%s', '%s', '%d', '%d', '%d', '%s', '%d' );

			$result = $wpdb->insert( $table_name, $data, $format );

			if ( ! $result ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$wpdb->query( 'ROLLBACK' );
				return false;
			}

			$child_ids[] = $wpdb->insert_id;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query( 'COMMIT' );

		return $child_ids;
	}

	/**
	 * Create a transfer between two budgets
	 *
	 * Creates a parent entry (type 'transfer') with two children:
	 * a cost child (source budget) and an income child (target budget).
	 *
	 * @param float       $amount            Transfer amount (positive value).
	 * @param string      $entry_date        Entry date (Y-m-d format).
	 * @param int         $source_budget_id  Source budget ID (money comes from).
	 * @param int         $target_budget_id  Target budget ID (money goes to).
	 * @param string|null $description       Transfer description.
	 * @param string|null $event_url         Event URL.
	 * @param int|null    $event_date_id     Event date ID.
	 * @return int|false The parent entry ID on success, false on failure.
	 */
	public static function create_transfer( $amount, $entry_date, $source_budget_id, $target_budget_id, $description = null, $event_url = null, $event_date_id = null, $participant_id = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Start transaction.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query( 'START TRANSACTION' );

		// Create parent entry (transfer).
		$parent_data = array(
			'amount'         => abs( (float) $amount ),
			'entry_type'     => 'transfer',
			'entry_date'     => $entry_date,
			'description'    => $description,
			'participant_id' => $participant_id ? (int) $participant_id : null,
		);

		$result = $wpdb->insert( $table_name, $parent_data, array( '%f', '%s', '%s', '%s', '%d' ) );

		if ( ! $result ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( 'ROLLBACK' );
			return false;
		}

		$parent_id = $wpdb->insert_id;

		// Create cost child (source budget).
		$cost_data = array(
			'amount'          => abs( (float) $amount ),
			'entry_type'      => 'cost',
			'entry_date'      => $entry_date,
			'description'     => $description,
			'budget_id'       => (int) $source_budget_id,
			'parent_entry_id' => $parent_id,
			'event_url'       => $event_url ? $event_url : null,
			'event_date_id'   => $event_date_id ? (int) $event_date_id : null,
		);

		$result = $wpdb->insert( $table_name, $cost_data, array( '%f', '%s', '%s', '%s', '%d', '%d', '%s', '%d' ) );

		if ( ! $result ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( 'ROLLBACK' );
			return false;
		}

		// Create income child (target budget).
		$income_data = array(
			'amount'          => abs( (float) $amount ),
			'entry_type'      => 'income',
			'entry_date'      => $entry_date,
			'description'     => $description,
			'budget_id'       => (int) $target_budget_id,
			'parent_entry_id' => $parent_id,
			'event_url'       => $event_url ? $event_url : null,
			'event_date_id'   => $event_date_id ? (int) $event_date_id : null,
		);

		$result = $wpdb->insert( $table_name, $income_data, array( '%f', '%s', '%s', '%s', '%d', '%d', '%s', '%d' ) );

		if ( ! $result ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( 'ROLLBACK' );
			return false;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query( 'COMMIT' );

		return $parent_id;
	}

	/**
	 * Update an existing transfer
	 *
	 * Deletes old children and recreates with new values, updates parent.
	 *
	 * @param int         $id                Parent transfer entry ID.
	 * @param float       $amount            Transfer amount (positive value).
	 * @param string      $entry_date        Entry date (Y-m-d format).
	 * @param int         $source_budget_id  Source budget ID.
	 * @param int         $target_budget_id  Target budget ID.
	 * @param string|null $description       Transfer description.
	 * @param string|null $event_url         Event URL.
	 * @param int|null    $event_date_id     Event date ID.
	 * @return bool True on success, false on failure.
	 */
	public static function update_transfer( $id, $amount, $entry_date, $source_budget_id, $target_budget_id, $description = null, $event_url = null, $event_date_id = null, $participant_id = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Validate the entry exists and is a transfer.
		$entry = self::get_by_id( $id );
		if ( ! $entry || 'transfer' !== $entry->entry_type ) {
			return false;
		}

		// Must have children.
		if ( ! self::has_children( $id ) ) {
			return false;
		}

		// Start transaction.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query( 'START TRANSACTION' );

		// Update parent.
		$parent_result = $wpdb->update(
			$table_name,
			array(
				'amount'         => abs( (float) $amount ),
				'entry_date'     => $entry_date,
				'description'    => $description,
				'participant_id' => $participant_id ? (int) $participant_id : null,
			),
			array( 'id' => $id ),
			array( '%f', '%s', '%s', '%d' ),
			array( '%d' )
		);

		if ( false === $parent_result ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( 'ROLLBACK' );
			return false;
		}

		// Delete existing children.
		$delete_result = $wpdb->delete(
			$table_name,
			array( 'parent_entry_id' => $id ),
			array( '%d' )
		);

		if ( false === $delete_result ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( 'ROLLBACK' );
			return false;
		}

		// Create cost child (source budget).
		$cost_data = array(
			'amount'          => abs( (float) $amount ),
			'entry_type'      => 'cost',
			'entry_date'      => $entry_date,
			'description'     => $description,
			'budget_id'       => (int) $source_budget_id,
			'parent_entry_id' => $id,
			'event_url'       => $event_url ? $event_url : null,
			'event_date_id'   => $event_date_id ? (int) $event_date_id : null,
		);

		$result = $wpdb->insert( $table_name, $cost_data, array( '%f', '%s', '%s', '%s', '%d', '%d', '%s', '%d' ) );

		if ( ! $result ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( 'ROLLBACK' );
			return false;
		}

		// Create income child (target budget).
		$income_data = array(
			'amount'          => abs( (float) $amount ),
			'entry_type'      => 'income',
			'entry_date'      => $entry_date,
			'description'     => $description,
			'budget_id'       => (int) $target_budget_id,
			'parent_entry_id' => $id,
			'event_url'       => $event_url ? $event_url : null,
			'event_date_id'   => $event_date_id ? (int) $event_date_id : null,
		);

		$result = $wpdb->insert( $table_name, $income_data, array( '%f', '%s', '%s', '%s', '%d', '%d', '%s', '%d' ) );

		if ( ! $result ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( 'ROLLBACK' );
			return false;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query( 'COMMIT' );

		return true;
	}

	/**
	 * Unsplit an entry by deleting all child entries
	 *
	 * @param int $id Parent entry ID.
	 * @return bool True on success, false on failure.
	 */
	public static function unsplit_entry( $id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Validate the entry exists and has children.
		$entry = self::get_by_id( $id );
		if ( ! $entry ) {
			return false;
		}

		if ( ! self::has_children( $id ) ) {
			return false;
		}

		// Delete all child entries.
		$result = $wpdb->delete(
			$table_name,
			array( 'parent_entry_id' => $id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Get distinct event URLs from all entries
	 *
	 * @return string[] Array of unique event URLs.
	 */
	public static function get_distinct_event_urls() {
		global $wpdb;

		$table_name = self::get_table_name();

		$results = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT DISTINCT event_url FROM %i WHERE event_url IS NOT NULL ORDER BY event_url ASC',
				$table_name
			)
		);

		return $results ? $results : array();
	}

	/**
	 * Get distinct event date IDs from all entries
	 *
	 * @return int[] Array of unique event date IDs.
	 */
	public static function get_distinct_event_date_ids() {
		global $wpdb;

		$table_name = self::get_table_name();

		$results = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT DISTINCT event_date_id FROM %i WHERE event_date_id IS NOT NULL ORDER BY event_date_id ASC',
				$table_name
			)
		);

		return $results ? array_map( 'intval', $results ) : array();
	}

	/**
	 * Hydrate an entry object from a database row
	 *
	 * @param object $row Database row.
	 * @return FinancialEntry Entry object.
	 */
	private static function hydrate( $row ) {
		$entry                     = new self();
		$entry->id                 = (int) $row->id;
		$entry->amount             = (float) $row->amount;
		$entry->entry_type         = $row->entry_type;
		$entry->entry_date         = $row->entry_date;
		$entry->description        = $row->description;
		$entry->budget_id          = $row->budget_id ? (int) $row->budget_id : null;
		$entry->transaction_id     = $row->transaction_id ? (int) $row->transaction_id : null;
		$entry->external_reference = isset( $row->external_reference ) ? $row->external_reference : null;
		$entry->parent_entry_id    = isset( $row->parent_entry_id ) && $row->parent_entry_id ? (int) $row->parent_entry_id : null;
		$entry->event_url          = isset( $row->event_url ) ? $row->event_url : null;
		$entry->event_date_id      = isset( $row->event_date_id ) && $row->event_date_id ? (int) $row->event_date_id : null;
		$entry->participant_id     = isset( $row->participant_id ) && $row->participant_id ? (int) $row->participant_id : null;
		$entry->import_source      = isset( $row->import_source ) ? $row->import_source : null;
		$entry->imported_at        = isset( $row->imported_at ) ? $row->imported_at : null;
		$entry->created_at         = $row->created_at;
		$entry->updated_at         = $row->updated_at;

		// Load transaction IDs from junction table.
		if ( $entry->id ) {
			$entry->transaction_ids = EntryTransaction::get_transaction_ids_for_entry( $entry->id );
		}

		return $entry;
	}

	/**
	 * Convert entry to array
	 *
	 * @return array Entry data as array.
	 */
	public function to_array() {
		return array(
			'id'                 => $this->id,
			'amount'             => $this->amount,
			'entry_type'         => $this->entry_type,
			'entry_date'         => $this->entry_date,
			'description'        => $this->description,
			'budget_id'          => $this->budget_id,
			'transaction_id'     => $this->transaction_id,
			'transaction_ids'    => $this->transaction_ids,
			'external_reference' => $this->external_reference,
			'parent_entry_id'    => $this->parent_entry_id,
			'event_url'          => $this->event_url,
			'event_date_id'      => $this->event_date_id,
			'participant_id'     => $this->participant_id,
			'import_source'      => $this->import_source,
			'imported_at'        => $this->imported_at,
			'created_at'         => $this->created_at,
			'updated_at'         => $this->updated_at,
		);
	}
}
