<?php
/**
 * Instagram Post Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\InstagramPost;

defined( 'WPINC' ) || die;

/**
 * Repository for Instagram post data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class InstagramPostRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_instagram_posts';
	}

	/**
	 * Get all Instagram posts with optional filters.
	 *
	 * @param string|null $status  Optional status filter.
	 * @param string      $orderby Column to order by.
	 * @param string      $order   Order direction (ASC/DESC).
	 * @return InstagramPost[] Array of Instagram posts.
	 */
	public function get_all( $status = null, $orderby = 'created_at', $order = 'DESC' ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$allowed_orderby = array( 'id', 'status', 'created_at', 'published_at' );
		$orderby         = in_array( $orderby, $allowed_orderby, true ) ? $orderby : 'created_at';
		$order           = in_array( strtoupper( $order ), array( 'ASC', 'DESC' ), true ) ? strtoupper( $order ) : 'DESC';

		$where_clauses = array();
		$where_values  = array( $table_name );

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
				return new InstagramPost( $row );
			},
			$results
		);
	}

	/**
	 * Get Instagram post by ID.
	 *
	 * @param int $id Post ID.
	 * @return InstagramPost|null Post or null if not found.
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

		return $result ? new InstagramPost( $result ) : null;
	}

	/**
	 * Delete Instagram post by ID.
	 *
	 * @param int $id Post ID.
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
