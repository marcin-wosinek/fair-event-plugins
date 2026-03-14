<?php
/**
 * ParticipantCategory Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

defined( 'WPINC' ) || die;

/**
 * Repository for participant-category mailing subscriptions.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ParticipantCategoryRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_participant_categories';
	}

	/**
	 * Get category IDs for a participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return int[] Array of category IDs.
	 */
	public function get_category_ids_by_participant( $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT category_id FROM %i WHERE participant_id = %d ORDER BY created_at ASC',
				$table_name,
				$participant_id
			)
		);

		return array_map( 'intval', $results );
	}

	/**
	 * Set categories for a participant (replace all).
	 *
	 * @param int   $participant_id Participant ID.
	 * @param int[] $category_ids   Array of category IDs.
	 * @return bool Success.
	 */
	public function set_categories( $participant_id, array $category_ids ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		// Delete existing categories.
		$wpdb->delete(
			$table_name,
			array( 'participant_id' => $participant_id ),
			array( '%d' )
		);

		// Insert new categories.
		foreach ( $category_ids as $category_id ) {
			$category_id = (int) $category_id;
			if ( $category_id > 0 ) {
				$wpdb->insert(
					$table_name,
					array(
						'participant_id' => $participant_id,
						'category_id'    => $category_id,
					),
					array( '%d', '%d' )
				);
			}
		}

		return true;
	}

	/**
	 * Check if a participant has any category subscriptions.
	 *
	 * @param int $participant_id Participant ID.
	 * @return bool True if participant has category subscriptions.
	 */
	public function has_any_categories( $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$count = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE participant_id = %d',
				$table_name,
				$participant_id
			)
		);

		return (int) $count > 0;
	}

	/**
	 * Delete all categories for a participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return bool Success.
	 */
	public function delete_by_participant( $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array( 'participant_id' => $participant_id ),
			array( '%d' )
		) !== false;
	}

	/**
	 * Get category subscriptions for multiple participants.
	 *
	 * @param int[] $participant_ids Array of participant IDs.
	 * @return array Associative array: participant_id => array of category IDs.
	 */
	public function get_categories_for_participants( array $participant_ids ) {
		global $wpdb;

		if ( empty( $participant_ids ) ) {
			return array();
		}

		$table_name = $this->get_table_name();

		$placeholders = implode( ',', array_fill( 0, count( $participant_ids ), '%d' ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- $placeholders is safely constructed.
		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT participant_id, category_id FROM %i WHERE participant_id IN ($placeholders) ORDER BY created_at ASC",
				array_merge( array( $table_name ), array_map( 'intval', $participant_ids ) )
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

		$categories = array();

		// Initialize all requested participants with empty arrays.
		foreach ( $participant_ids as $id ) {
			$categories[ (int) $id ] = array();
		}

		// Fill in actual categories.
		foreach ( $results as $row ) {
			$participant_id                  = (int) $row['participant_id'];
			$categories[ $participant_id ][] = (int) $row['category_id'];
		}

		return $categories;
	}
}
