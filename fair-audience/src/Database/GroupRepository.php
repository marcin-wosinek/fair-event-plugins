<?php
/**
 * Group Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\Group;

defined( 'WPINC' ) || die;

/**
 * Repository for group data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class GroupRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_groups';
	}

	/**
	 * Get all groups.
	 *
	 * @param string $orderby Column to order by.
	 * @param string $order   Order direction (ASC/DESC).
	 * @return Group[] Array of groups.
	 */
	public function get_all( $orderby = 'name', $order = 'ASC' ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$allowed_orderby = array( 'id', 'name', 'created_at', 'updated_at' );
		$orderby         = in_array( $orderby, $allowed_orderby, true ) ? $orderby : 'name';
		$order           = in_array( strtoupper( $order ), array( 'ASC', 'DESC' ), true ) ? strtoupper( $order ) : 'ASC';

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
				return new Group( $row );
			},
			$results
		);
	}

	/**
	 * Get group by ID.
	 *
	 * @param int $id Group ID.
	 * @return Group|null Group or null if not found.
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

		return $result ? new Group( $result ) : null;
	}

	/**
	 * Get group by name.
	 *
	 * @param string $name Group name.
	 * @return Group|null Group or null if not found.
	 */
	public function get_by_name( $name ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE name = %s',
				$table_name,
				$name
			),
			ARRAY_A
		);

		return $result ? new Group( $result ) : null;
	}

	/**
	 * Search groups by name.
	 *
	 * @param string $search_term Search term.
	 * @return Group[] Array of groups.
	 */
	public function search( $search_term ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$like       = '%' . $wpdb->esc_like( $search_term ) . '%';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE name LIKE %s OR description LIKE %s ORDER BY name ASC',
				$table_name,
				$like,
				$like
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new Group( $row );
			},
			$results
		);
	}

	/**
	 * Get total count of groups.
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

	/**
	 * Get all groups with member counts.
	 *
	 * @param string $orderby Column to order by.
	 * @param string $order   Order direction (ASC/DESC).
	 * @return array Array of groups with member_count field.
	 */
	public function get_all_with_member_counts( $orderby = 'name', $order = 'ASC' ) {
		global $wpdb;

		$table_name          = $this->get_table_name();
		$junction_table_name = $wpdb->prefix . 'fair_audience_group_participants';

		$allowed_orderby = array( 'id', 'name', 'created_at', 'updated_at', 'member_count' );
		$orderby         = in_array( $orderby, $allowed_orderby, true ) ? $orderby : 'name';
		$order           = in_array( strtoupper( $order ), array( 'ASC', 'DESC' ), true ) ? strtoupper( $order ) : 'ASC';

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $order is safely validated above.
		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT g.*, COALESCE(gp.member_count, 0) as member_count
				FROM %i g
				LEFT JOIN (
					SELECT group_id, COUNT(*) as member_count
					FROM %i
					GROUP BY group_id
				) gp ON g.id = gp.group_id
				ORDER BY %i $order",
				$table_name,
				$junction_table_name,
				$orderby
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return array_map(
			function ( $row ) {
				$group               = new Group( $row );
				$group->member_count = (int) $row['member_count'];
				return $group;
			},
			$results
		);
	}
}
