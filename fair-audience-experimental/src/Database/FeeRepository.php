<?php
/**
 * Fee Repository
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Database;

use FairAudienceExperimental\Models\Fee;

defined( 'WPINC' ) || die;

/**
 * Repository for fee data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class FeeRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_fees';
	}

	/**
	 * Whether the Fair Finance budgets table exists.
	 *
	 * Fees keep their `budget_id` either way; without the table there is no
	 * name to show for it.
	 *
	 * @return bool True when budget names can be joined.
	 */
	private function budgets_table_exists() {
		global $wpdb;

		$budgets_table = $wpdb->prefix . 'fair_payment_budgets';

		return $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $budgets_table ) ) ) === $budgets_table;
	}

	/**
	 * Get all fees with summary data.
	 *
	 * `budget_name` is null for every fee when the Fair Finance budgets table
	 * is absent.
	 *
	 * @param string $orderby Column to order by.
	 * @param string $order   Order direction (ASC/DESC).
	 * @return array Array of fee data with summary fields.
	 */
	public function get_all_with_summary( $orderby = 'created_at', $order = 'DESC' ) {
		global $wpdb;

		$table_name     = $this->get_table_name();
		$groups_table   = $wpdb->prefix . 'fair_audience_groups';
		$payments_table = $wpdb->prefix . 'fair_audience_fee_payments';
		$budgets_table  = $wpdb->prefix . 'fair_payment_budgets';

		$allowed_orderby = array( 'id', 'name', 'amount', 'due_date', 'status', 'created_at' );
		$orderby         = in_array( $orderby, $allowed_orderby, true ) ? $orderby : 'created_at';
		$order           = in_array( strtoupper( $order ), array( 'ASC', 'DESC' ), true ) ? strtoupper( $order ) : 'DESC';

		$args = array( $table_name, $groups_table );
		if ( $this->budgets_table_exists() ) {
			$budget_name = 'b.name';
			$budget_join = 'LEFT JOIN %i b ON f.budget_id = b.id';
			$args[]      = $budgets_table;
		} else {
			$budget_name = 'NULL';
			$budget_join = '';
		}
		$args[] = $payments_table;
		$args[] = $orderby;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $order is safely validated above; the budget fragments are the fixed strings chosen above.
		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT f.*,
					g.name as group_name,
					$budget_name as budget_name,
					COALESCE(ps.pending_count, 0) as pending_count,
					COALESCE(ps.paid_count, 0) as paid_count,
					COALESCE(ps.member_count, 0) as member_count,
					COALESCE(ps.total_amount, 0) as total_amount
				FROM %i f
				LEFT JOIN %i g ON f.group_id = g.id
				$budget_join
				LEFT JOIN (
					SELECT fee_id,
						SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
						SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
						COUNT(*) as member_count,
						SUM(amount) as total_amount
					FROM %i
					GROUP BY fee_id
				) ps ON f.id = ps.fee_id
				ORDER BY f.%i $order",
				$args
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		return $results;
	}

	/**
	 * Get fee by ID.
	 *
	 * @param int $id Fee ID.
	 * @return Fee|null Fee or null if not found.
	 */
	public function get_by_id( $id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d',
				$table_name,
				$id
			),
			ARRAY_A
		);

		return $result ? new Fee( $result ) : null;
	}

	/**
	 * Get fee by ID with group and budget names.
	 *
	 * `budget_name` is null when the Fair Finance budgets table is absent.
	 *
	 * @param int $id Fee ID.
	 * @return array|null Fee data with group_name and budget_name, or null.
	 */
	public function get_by_id_with_group( $id ) {
		global $wpdb;

		$table_name    = $this->get_table_name();
		$groups_table  = $wpdb->prefix . 'fair_audience_groups';
		$budgets_table = $wpdb->prefix . 'fair_payment_budgets';

		if ( ! $this->budgets_table_exists() ) {
			return $wpdb->get_row(
				$wpdb->prepare(
					'SELECT f.*, g.name as group_name, NULL as budget_name FROM %i f LEFT JOIN %i g ON f.group_id = g.id WHERE f.id = %d',
					$table_name,
					$groups_table,
					$id
				),
				ARRAY_A
			);
		}

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT f.*, g.name as group_name, b.name as budget_name FROM %i f LEFT JOIN %i g ON f.group_id = g.id LEFT JOIN %i b ON f.budget_id = b.id WHERE f.id = %d',
				$table_name,
				$groups_table,
				$budgets_table,
				$id
			),
			ARRAY_A
		);

		return $result;
	}

	/**
	 * Get total count of fees.
	 *
	 * @return int Count.
	 */
	public function get_count() {
		global $wpdb;

		$table_name = $this->get_table_name();

		return (int) $wpdb->get_var(
			$wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table_name )
		);
	}
}
