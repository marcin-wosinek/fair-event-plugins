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
	 * Entry type: 'cost' or 'income'
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
	 * Transaction ID (foreign key to payments table)
	 *
	 * @var int|null
	 */
	public $transaction_id;

	/**
	 * External reference for deduplication (e.g., from imported data)
	 *
	 * @var string|null
	 */
	public $external_reference;

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
			'date_from'  => null,
			'date_to'    => null,
			'budget_id'  => null,
			'entry_type' => null,
			'unmatched'  => false,
			'per_page'   => 50,
			'page'       => 1,
		);

		$filters = wp_parse_args( $filters, $defaults );

		// Build WHERE clause.
		$where_clauses = array();
		$where_values  = array();

		if ( ! empty( $filters['date_from'] ) ) {
			$where_clauses[] = 'entry_date >= %s';
			$where_values[]  = $filters['date_from'];
		}

		if ( ! empty( $filters['date_to'] ) ) {
			$where_clauses[] = 'entry_date <= %s';
			$where_values[]  = $filters['date_to'];
		}

		if ( ! empty( $filters['budget_id'] ) ) {
			$where_clauses[] = 'budget_id = %d';
			$where_values[]  = (int) $filters['budget_id'];
		}

		if ( ! empty( $filters['entry_type'] ) && in_array( $filters['entry_type'], array( 'cost', 'income' ), true ) ) {
			$where_clauses[] = 'entry_type = %s';
			$where_values[]  = $filters['entry_type'];
		}

		if ( ! empty( $filters['unmatched'] ) ) {
			$where_clauses[] = 'transaction_id IS NULL';
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
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$query .= $wpdb->prepare( ' ORDER BY entry_date DESC, id DESC LIMIT %d OFFSET %d', $per_page, $offset );

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
		$where_clauses = array();
		$where_values  = array();

		if ( ! empty( $filters['date_from'] ) ) {
			$where_clauses[] = 'entry_date >= %s';
			$where_values[]  = $filters['date_from'];
		}

		if ( ! empty( $filters['date_to'] ) ) {
			$where_clauses[] = 'entry_date <= %s';
			$where_values[]  = $filters['date_to'];
		}

		if ( ! empty( $filters['budget_id'] ) ) {
			$where_clauses[] = 'budget_id = %d';
			$where_values[]  = (int) $filters['budget_id'];
		}

		if ( ! empty( $filters['unmatched'] ) ) {
			$where_clauses[] = 'transaction_id IS NULL';
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
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT budget_id, entry_type, SUM(amount) as total, COUNT(*) as count FROM %i GROUP BY budget_id, entry_type',
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
	public static function create( $amount, $entry_type, $entry_date, $description = null, $budget_id = null, $transaction_id = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Validate entry_type.
		if ( ! in_array( $entry_type, array( 'cost', 'income' ), true ) ) {
			return false;
		}

		$data = array(
			'amount'         => abs( (float) $amount ),
			'entry_type'     => $entry_type,
			'entry_date'     => $entry_date,
			'description'    => $description,
			'budget_id'      => $budget_id ? (int) $budget_id : null,
			'transaction_id' => $transaction_id ? (int) $transaction_id : null,
		);

		$format = array( '%f', '%s', '%s', '%s', '%d', '%d' );

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
	public static function update( $id, $amount, $entry_type, $entry_date, $description = null, $budget_id = null, $transaction_id = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Validate entry_type.
		if ( ! in_array( $entry_type, array( 'cost', 'income' ), true ) ) {
			return false;
		}

		$data = array(
			'amount'         => abs( (float) $amount ),
			'entry_type'     => $entry_type,
			'entry_date'     => $entry_date,
			'description'    => $description,
			'budget_id'      => $budget_id ? (int) $budget_id : null,
			'transaction_id' => $transaction_id ? (int) $transaction_id : null,
		);

		$format = array( '%f', '%s', '%s', '%s', '%d', '%d' );

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
	 * Unmatch entry from transaction
	 *
	 * @param int $id Entry ID.
	 * @return bool True on success, false on failure.
	 */
	public static function unmatch_transaction( $id ) {
		global $wpdb;

		$table_name = self::get_table_name();

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
	 * @return int|false The entry ID on success, false on failure.
	 */
	public static function create_with_external_reference( $amount, $entry_type, $entry_date, $external_reference, $description = null, $budget_id = null ) {
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
		);

		$format = array( '%f', '%s', '%s', '%s', '%d', '%s' );

		$result = $wpdb->insert( $table_name, $data, $format );

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
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
		$entry->created_at         = $row->created_at;
		$entry->updated_at         = $row->updated_at;

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
			'external_reference' => $this->external_reference,
			'created_at'         => $this->created_at,
			'updated_at'         => $this->updated_at,
		);
	}
}
