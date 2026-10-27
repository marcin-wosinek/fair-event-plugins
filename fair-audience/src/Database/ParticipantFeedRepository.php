<?php
/**
 * ParticipantFeed Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

defined( 'WPINC' ) || die;

/**
 * Repository for the weekly email feeds a participant chose.
 *
 * Feeds are Fair Events event sources, by numeric ID. The rows only count
 * while the participant's weekly_feed_mode is 'selected'.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ParticipantFeedRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_participant_feeds';
	}

	/**
	 * Feed IDs a participant chose.
	 *
	 * @param int $participant_id Participant ID.
	 * @return int[] Feed IDs.
	 */
	public function get_feed_ids_by_participant( $participant_id ) {
		global $wpdb;

		$results = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT feed_id FROM %i WHERE participant_id = %d ORDER BY feed_id ASC',
				$this->get_table_name(),
				$participant_id
			)
		);

		return array_map( 'intval', $results );
	}

	/**
	 * IDs of the participants who chose a feed.
	 *
	 * @param int $feed_id Feed ID.
	 * @return int[] Participant IDs.
	 */
	public function get_participant_ids_by_feed( $feed_id ) {
		global $wpdb;

		$results = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT participant_id FROM %i WHERE feed_id = %d',
				$this->get_table_name(),
				$feed_id
			)
		);

		return array_map( 'intval', $results );
	}

	/**
	 * Replace a participant's feeds.
	 *
	 * Runs in a transaction, so a failure leaves the earlier feeds in place.
	 *
	 * @param int   $participant_id Participant ID.
	 * @param int[] $feed_ids       Feed IDs; empty for none.
	 * @return bool Whether every change was stored.
	 */
	public function set_feeds( $participant_id, array $feed_ids ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$feed_ids   = array_values( array_unique( array_filter( array_map( 'intval', $feed_ids ) ) ) );

		$wpdb->query( 'START TRANSACTION' );

		$ok = false !== $wpdb->delete(
			$table_name,
			array( 'participant_id' => $participant_id ),
			array( '%d' )
		);

		foreach ( $feed_ids as $feed_id ) {
			if ( ! $ok ) {
				break;
			}
			$ok = false !== $wpdb->insert(
				$table_name,
				array(
					'participant_id' => $participant_id,
					'feed_id'        => $feed_id,
				),
				array( '%d', '%d' )
			);
		}

		$wpdb->query( $ok ? 'COMMIT' : 'ROLLBACK' );

		return $ok;
	}

	/**
	 * Delete all feeds of a participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return bool Success.
	 */
	public function delete_by_participant( $participant_id ) {
		global $wpdb;

		return $wpdb->delete(
			$this->get_table_name(),
			array( 'participant_id' => $participant_id ),
			array( '%d' )
		) !== false;
	}
}
