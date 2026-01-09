<?php
/**
 * Poll Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\Poll;

defined( 'WPINC' ) || die;

/**
 * Repository for poll data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PollRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_polls';
	}

	/**
	 * Get all polls with optional filters.
	 *
	 * @param int|null    $event_id Optional event ID filter.
	 * @param string|null $status   Optional status filter.
	 * @param string      $orderby  Column to order by.
	 * @param string      $order    Order direction (ASC/DESC).
	 * @return Poll[] Array of polls.
	 */
	public function get_all( $event_id = null, $status = null, $orderby = 'created_at', $order = 'DESC' ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$allowed_orderby = array( 'id', 'event_id', 'title', 'status', 'created_at', 'updated_at' );
		$orderby         = in_array( $orderby, $allowed_orderby, true ) ? $orderby : 'created_at';
		$order           = in_array( strtoupper( $order ), array( 'ASC', 'DESC' ), true ) ? strtoupper( $order ) : 'DESC';

		$where_clauses = array();
		$where_values  = array( $table_name );

		if ( null !== $event_id ) {
			$where_clauses[] = 'event_id = %d';
			$where_values[]  = $event_id;
		}

		if ( null !== $status ) {
			$where_clauses[] = 'status = %s';
			$where_values[]  = $status;
		}

		$where_sql = ! empty( $where_clauses ) ? 'WHERE ' . implode( ' AND ', $where_clauses ) : '';

		$where_values[] = $orderby;

		$query = "SELECT * FROM %i $where_sql ORDER BY %i $order";

		$results = $wpdb->get_results(
			$wpdb->prepare( $query, ...$where_values ),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new Poll( $row );
			},
			$results
		);
	}

	/**
	 * Get poll by ID.
	 *
	 * @param int $id Poll ID.
	 * @return Poll|null Poll or null if not found.
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

		return $result ? new Poll( $result ) : null;
	}

	/**
	 * Get all polls for an event.
	 *
	 * @param int $event_id Event ID.
	 * @return Poll[] Array of polls.
	 */
	public function get_by_event( $event_id ) {
		return $this->get_all( $event_id );
	}

	/**
	 * Delete poll by ID.
	 *
	 * @param int $id Poll ID.
	 * @return bool Success.
	 */
	public function delete( $id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array( 'id' => $id ),
			array( '%d' )
		) !== false;
	}
}
