<?php
/**
 * GroupParticipant Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\GroupParticipant;

defined( 'WPINC' ) || die;

/**
 * Repository for group-participant relationships.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class GroupParticipantRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_group_participants';
	}

	/**
	 * Get all participants for a group.
	 *
	 * @param int $group_id Group ID.
	 * @return GroupParticipant[] Array of group-participant relationships.
	 */
	public function get_by_group( $group_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE group_id = %d ORDER BY created_at ASC',
				$table_name,
				$group_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new GroupParticipant( $row );
			},
			$results
		);
	}

	/**
	 * Get all groups for a participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return GroupParticipant[] Array of group-participant relationships.
	 */
	public function get_by_participant( $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE participant_id = %d ORDER BY created_at DESC',
				$table_name,
				$participant_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new GroupParticipant( $row );
			},
			$results
		);
	}

	/**
	 * Get specific relationship.
	 *
	 * @param int $group_id       Group ID.
	 * @param int $participant_id Participant ID.
	 * @return GroupParticipant|null Relationship or null if not found.
	 */
	public function get_by_group_and_participant( $group_id, $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE group_id = %d AND participant_id = %d',
				$table_name,
				$group_id,
				$participant_id
			),
			ARRAY_A
		);

		return $result ? new GroupParticipant( $result ) : null;
	}

	/**
	 * Get relationship by ID.
	 *
	 * @param int $id Relationship ID.
	 * @return GroupParticipant|null Relationship or null if not found.
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

		return $result ? new GroupParticipant( $result ) : null;
	}

	/**
	 * Add participant to group.
	 *
	 * @param int $group_id       Group ID.
	 * @param int $participant_id Participant ID.
	 * @return int|false Relationship ID or false on failure.
	 */
	public function add_participant_to_group( $group_id, $participant_id ) {
		$existing = $this->get_by_group_and_participant( $group_id, $participant_id );
		if ( $existing ) {
			return false; // Already exists.
		}

		$relationship = new GroupParticipant(
			array(
				'group_id'       => $group_id,
				'participant_id' => $participant_id,
			)
		);

		return $relationship->save() ? $relationship->id : false;
	}

	/**
	 * Remove participant from group.
	 *
	 * @param int $group_id       Group ID.
	 * @param int $participant_id Participant ID.
	 * @return bool Success.
	 */
	public function remove_participant_from_group( $group_id, $participant_id ) {
		$relationship = $this->get_by_group_and_participant( $group_id, $participant_id );

		if ( ! $relationship ) {
			return false;
		}

		return $relationship->delete();
	}

	/**
	 * Get member count for a group.
	 *
	 * @param int $group_id Group ID.
	 * @return int Member count.
	 */
	public function get_member_count( $group_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE group_id = %d',
				$table_name,
				$group_id
			)
		);
	}

	/**
	 * Get all participants for a group with participant details.
	 *
	 * @param int $group_id Group ID.
	 * @return array Array of participant data with relationship info.
	 */
	public function get_members_with_details( $group_id ) {
		global $wpdb;

		$table_name         = $this->get_table_name();
		$participants_table = $wpdb->prefix . 'fair_audience_participants';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT gp.id as relationship_id, gp.created_at as joined_at, p.*
				FROM %i gp
				INNER JOIN %i p ON gp.participant_id = p.id
				WHERE gp.group_id = %d
				ORDER BY p.surname ASC, p.name ASC',
				$table_name,
				$participants_table,
				$group_id
			),
			ARRAY_A
		);

		return $results;
	}

	/**
	 * Get group counts for all participants.
	 *
	 * @return array Associative array: participant_id => group_count.
	 */
	public function get_group_counts_for_all_participants() {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT participant_id, COUNT(*) as group_count FROM %i GROUP BY participant_id',
				$table_name
			),
			ARRAY_A
		);

		$counts = array();

		foreach ( $results as $row ) {
			$counts[ (int) $row['participant_id'] ] = (int) $row['group_count'];
		}

		return $counts;
	}

	/**
	 * Get group counts for specific participants.
	 *
	 * @param array $participant_ids Array of participant IDs.
	 * @return array Associative array: participant_id => group_count.
	 */
	public function get_group_counts_for_participants( $participant_ids ) {
		global $wpdb;

		if ( empty( $participant_ids ) ) {
			return array();
		}

		$table_name = $this->get_table_name();

		// Build placeholders for IN clause.
		$placeholders = implode( ',', array_fill( 0, count( $participant_ids ), '%d' ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- $placeholders is safely constructed.
		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT participant_id, COUNT(*) as group_count FROM %i WHERE participant_id IN ($placeholders) GROUP BY participant_id",
				array_merge( array( $table_name ), array_map( 'intval', $participant_ids ) )
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

		$counts = array();

		// Initialize all requested participants with zero counts.
		foreach ( $participant_ids as $id ) {
			$counts[ (int) $id ] = 0;
		}

		// Fill in actual counts.
		foreach ( $results as $row ) {
			$counts[ (int) $row['participant_id'] ] = (int) $row['group_count'];
		}

		return $counts;
	}
}
