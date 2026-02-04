<?php
/**
 * Budget model for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Models;

use FairPayment\Database\Schema;

defined( 'WPINC' ) || die;

/**
 * Budget model class
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class Budget {

	/**
	 * Budget ID
	 *
	 * @var int
	 */
	public $id;

	/**
	 * Budget name
	 *
	 * @var string
	 */
	public $name;

	/**
	 * Budget description
	 *
	 * @var string|null
	 */
	public $description;

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
		return Schema::get_budgets_table_name();
	}

	/**
	 * Get budget by ID
	 *
	 * @param int $id Budget ID.
	 * @return Budget|null Budget object or null if not found.
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
	 * Get all budgets
	 *
	 * @param string $order_by Column to order by (default 'name').
	 * @param string $order    Order direction ASC or DESC (default 'ASC').
	 * @return Budget[] Array of Budget objects.
	 */
	public static function get_all( $order_by = 'name', $order = 'ASC' ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// Validate order_by to prevent SQL injection.
		$allowed_columns = array( 'id', 'name', 'description', 'created_at', 'updated_at' );
		if ( ! in_array( $order_by, $allowed_columns, true ) ) {
			$order_by = 'name';
		}

		// Validate order direction.
		$order = strtoupper( $order ) === 'DESC' ? 'DESC' : 'ASC';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i ORDER BY %i ' . $order, // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$table_name,
				$order_by
			)
		);

		if ( ! $results ) {
			return array();
		}

		$budgets = array();
		foreach ( $results as $result ) {
			$budgets[] = self::hydrate( $result );
		}

		return $budgets;
	}

	/**
	 * Create a new budget
	 *
	 * @param string      $name        Budget name.
	 * @param string|null $description Budget description.
	 * @return int|false The budget ID on success, false on failure.
	 */
	public static function create( $name, $description = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$data = array(
			'name'        => $name,
			'description' => $description,
		);

		$format = array( '%s', '%s' );

		$result = $wpdb->insert( $table_name, $data, $format );

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Update a budget
	 *
	 * @param int         $id          Budget ID.
	 * @param string      $name        Budget name.
	 * @param string|null $description Budget description.
	 * @return bool True on success, false on failure.
	 */
	public static function update( $id, $name, $description = null ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$data = array(
			'name'        => $name,
			'description' => $description,
		);

		$format = array( '%s', '%s' );

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
	 * Delete a budget
	 *
	 * @param int $id Budget ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete( $id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		// First, clear budget_id references from financial entries.
		$entries_table = Schema::get_financial_entries_table_name();
		$wpdb->update(
			$entries_table,
			array( 'budget_id' => null ),
			array( 'budget_id' => $id ),
			array( '%d' ),
			array( '%d' )
		);

		// Then delete the budget.
		$result = $wpdb->delete(
			$table_name,
			array( 'id' => $id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Hydrate a budget object from a database row
	 *
	 * @param object $row Database row.
	 * @return Budget Budget object.
	 */
	private static function hydrate( $row ) {
		$budget              = new self();
		$budget->id          = (int) $row->id;
		$budget->name        = $row->name;
		$budget->description = $row->description;
		$budget->created_at  = $row->created_at;
		$budget->updated_at  = $row->updated_at;

		return $budget;
	}

	/**
	 * Convert budget to array
	 *
	 * @return array Budget data as array.
	 */
	public function to_array() {
		return array(
			'id'          => $this->id,
			'name'        => $this->name,
			'description' => $this->description,
			'created_at'  => $this->created_at,
			'updated_at'  => $this->updated_at,
		);
	}
}
