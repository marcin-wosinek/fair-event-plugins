<?php
/**
 * Participant Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\Participant;

defined( 'WPINC' ) || die;

/**
 * Repository for participant data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ParticipantRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_participants';
	}

	/**
	 * Get all participants.
	 *
	 * @param string $orderby Column to order by.
	 * @param string $order   Order direction (ASC/DESC).
	 * @return Participant[] Array of participants.
	 */
	public function get_all( $orderby = 'surname', $order = 'ASC' ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$allowed_orderby = array( 'id', 'name', 'surname', 'email', 'created_at' );
		$orderby         = in_array( $orderby, $allowed_orderby, true ) ? $orderby : 'surname';
		$order           = in_array( strtoupper( $order ), array( 'ASC', 'DESC' ), true ) ? strtoupper( $order ) : 'ASC';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i ORDER BY %i $order",
				$table_name,
				$orderby
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new Participant( $row );
			},
			$results
		);
	}

	/**
	 * Get participant by ID.
	 *
	 * @param int $id Participant ID.
	 * @return Participant|null Participant or null if not found.
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

		return $result ? new Participant( $result ) : null;
	}

	/**
	 * Get participant by email.
	 *
	 * @param string $email Email address.
	 * @return Participant|null Participant or null if not found.
	 */
	public function get_by_email( $email ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE email = %s',
				$table_name,
				$email
			),
			ARRAY_A
		);

		return $result ? new Participant( $result ) : null;
	}

	/**
	 * Search participants by name or email.
	 *
	 * @param string $search_term Search term.
	 * @return Participant[] Array of participants.
	 */
	public function search( $search_term ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$like       = '%' . $wpdb->esc_like( $search_term ) . '%';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE name LIKE %s OR surname LIKE %s OR email LIKE %s ORDER BY surname ASC',
				$table_name,
				$like,
				$like,
				$like
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new Participant( $row );
			},
			$results
		);
	}

	/**
	 * Get total count of participants.
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
