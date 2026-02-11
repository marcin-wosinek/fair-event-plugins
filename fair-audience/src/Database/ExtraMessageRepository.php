<?php
/**
 * Extra Message Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\ExtraMessage;

defined( 'WPINC' ) || die;

/**
 * Repository for extra message data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ExtraMessageRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_extra_messages';
	}

	/**
	 * Get all extra messages.
	 *
	 * @param string $orderby Column to order by.
	 * @param string $order   Order direction (ASC/DESC).
	 * @return ExtraMessage[] Array of extra messages.
	 */
	public function get_all( $orderby = 'start_date', $order = 'DESC' ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$allowed_orderby = array( 'id', 'start_date', 'end_date', 'created_at', 'updated_at' );
		$orderby         = in_array( $orderby, $allowed_orderby, true ) ? $orderby : 'start_date';
		$order           = in_array( strtoupper( $order ), array( 'ASC', 'DESC' ), true ) ? strtoupper( $order ) : 'DESC';

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $order is safely validated above.
		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i ORDER BY %i $order",
				$table_name,
				$orderby
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return array_map(
			function ( $row ) {
				return new ExtraMessage( $row );
			},
			$results
		);
	}

	/**
	 * Get extra message by ID.
	 *
	 * @param int $id Extra message ID.
	 * @return ExtraMessage|null Extra message or null if not found.
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

		return $result ? new ExtraMessage( $result ) : null;
	}

	/**
	 * Get active extra messages (where today falls within the date range).
	 *
	 * @return ExtraMessage[] Array of active extra messages.
	 */
	public function get_active() {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE start_date <= CURDATE() AND end_date >= CURDATE() ORDER BY start_date ASC',
				$table_name
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new ExtraMessage( $row );
			},
			$results
		);
	}
}
