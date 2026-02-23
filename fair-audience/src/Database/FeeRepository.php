<?php
/**
 * Fee Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\Fee;

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
	 * Get all fees with summary data.
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

		$allowed_orderby = array( 'id', 'name', 'amount', 'due_date', 'status', 'created_at' );
		$orderby         = in_array( $orderby, $allowed_orderby, true ) ? $orderby : 'created_at';
		$order           = in_array( strtoupper( $order ), array( 'ASC', 'DESC' ), true ) ? strtoupper( $order ) : 'DESC';

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $order is safely validated above.
		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT f.*,
					g.name as group_name,
					COALESCE(ps.pending_count, 0) as pending_count,
					COALESCE(ps.paid_count, 0) as paid_count,
					COALESCE(ps.member_count, 0) as member_count,
					COALESCE(ps.total_amount, 0) as total_amount
				FROM %i f
				LEFT JOIN %i g ON f.group_id = g.id
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
				$table_name,
				$groups_table,
				$payments_table,
				$orderby
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

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
	 * Get fee by ID with group name.
	 *
	 * @param int $id Fee ID.
	 * @return array|null Fee data with group_name or null.
	 */
	public function get_by_id_with_group( $id ) {
		global $wpdb;

		$table_name   = $this->get_table_name();
		$groups_table = $wpdb->prefix . 'fair_audience_groups';

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT f.*, g.name as group_name FROM %i f LEFT JOIN %i g ON f.group_id = g.id WHERE f.id = %d',
				$table_name,
				$groups_table,
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
