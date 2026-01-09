<?php
/**
 * Poll Option Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\PollOption;

defined( 'WPINC' ) || die;

/**
 * Repository for poll option data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PollOptionRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_poll_options';
	}

	/**
	 * Get all options for a poll.
	 *
	 * @param int $poll_id Poll ID.
	 * @return PollOption[] Array of options ordered by display_order.
	 */
	public function get_by_poll( $poll_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE poll_id = %d ORDER BY display_order ASC',
				$table_name,
				$poll_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new PollOption( $row );
			},
			$results
		);
	}

	/**
	 * Get option by ID.
	 *
	 * @param int $id Option ID.
	 * @return PollOption|null Option or null if not found.
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

		return $result ? new PollOption( $result ) : null;
	}

	/**
	 * Delete all options for a poll.
	 *
	 * @param int $poll_id Poll ID.
	 * @return bool Success.
	 */
	public function delete_all_for_poll( $poll_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array( 'poll_id' => $poll_id ),
			array( '%d' )
		) !== false;
	}

	/**
	 * Bulk create options for a poll.
	 *
	 * @param int   $poll_id Poll ID.
	 * @param array $options Array of option data [['text' => '...', 'order' => 1], ...].
	 * @return bool Success.
	 */
	public function bulk_create( $poll_id, $options ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		foreach ( $options as $option ) {
			$poll_option = new PollOption();
			$poll_option->populate(
				array(
					'poll_id'       => $poll_id,
					'option_text'   => $option['text'],
					'display_order' => isset( $option['order'] ) ? $option['order'] : 0,
				)
			);

			if ( ! $poll_option->save() ) {
				return false;
			}
		}

		return true;
	}
}
