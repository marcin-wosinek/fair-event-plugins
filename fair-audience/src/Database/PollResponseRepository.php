<?php
/**
 * Poll Response Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\PollResponse;

defined( 'WPINC' ) || die;

/**
 * Repository for poll response data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PollResponseRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_poll_responses';
	}

	/**
	 * Save responses for a participant (atomic operation).
	 * Deletes existing responses and inserts new ones.
	 *
	 * @param int   $poll_id        Poll ID.
	 * @param int   $participant_id Participant ID.
	 * @param array $option_ids     Array of option IDs selected.
	 * @return bool Success.
	 */
	public function save_responses( $poll_id, $participant_id, $option_ids ) {
		global $wpdb;

		// Start transaction.
		$wpdb->query( 'START TRANSACTION' );

		// Delete existing responses.
		$deleted = $this->delete_responses_for_participant( $poll_id, $participant_id );

		// Insert new responses.
		foreach ( $option_ids as $option_id ) {
			$response = new PollResponse();
			$response->populate(
				array(
					'poll_id'        => $poll_id,
					'participant_id' => $participant_id,
					'option_id'      => $option_id,
				)
			);

			if ( ! $response->save() ) {
				$wpdb->query( 'ROLLBACK' );
				return false;
			}
		}

		// Commit transaction.
		$wpdb->query( 'COMMIT' );

		return true;
	}

	/**
	 * Get responses for a participant.
	 *
	 * @param int $poll_id        Poll ID.
	 * @param int $participant_id Participant ID.
	 * @return PollResponse[] Array of responses.
	 */
	public function get_by_participant( $poll_id, $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE poll_id = %d AND participant_id = %d',
				$table_name,
				$poll_id,
				$participant_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new PollResponse( $row );
			},
			$results
		);
	}

	/**
	 * Check if participant has responded to a poll.
	 *
	 * @param int $poll_id        Poll ID.
	 * @param int $participant_id Participant ID.
	 * @return bool True if participant has responded.
	 */
	public function has_responded( $poll_id, $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$count = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE poll_id = %d AND participant_id = %d',
				$table_name,
				$poll_id,
				$participant_id
			)
		);

		return (int) $count > 0;
	}

	/**
	 * Delete responses for a participant.
	 *
	 * @param int $poll_id        Poll ID.
	 * @param int $participant_id Participant ID.
	 * @return bool Success.
	 */
	public function delete_responses_for_participant( $poll_id, $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array(
				'poll_id'        => $poll_id,
				'participant_id' => $participant_id,
			),
			array( '%d', '%d' )
		) !== false;
	}

	/**
	 * Get response counts by option for a poll.
	 *
	 * @param int $poll_id Poll ID.
	 * @return array Array of ['option_id' => count, ...].
	 */
	public function get_response_counts( $poll_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT option_id, COUNT(*) as count FROM %i WHERE poll_id = %d GROUP BY option_id',
				$table_name,
				$poll_id
			),
			ARRAY_A
		);

		$counts = array();
		foreach ( $results as $row ) {
			$counts[ $row['option_id'] ] = (int) $row['count'];
		}

		return $counts;
	}
}
