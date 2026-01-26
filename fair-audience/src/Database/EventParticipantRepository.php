<?php
/**
 * EventParticipant Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\EventParticipant;

defined( 'WPINC' ) || die;

/**
 * Repository for event-participant relationships.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventParticipantRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_event_participants';
	}

	/**
	 * Get all participants for an event.
	 *
	 * @param int $event_id Event ID.
	 * @return EventParticipant[] Array of event-participant relationships.
	 */
	public function get_by_event( $event_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_id = %d ORDER BY created_at ASC',
				$table_name,
				$event_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new EventParticipant( $row );
			},
			$results
		);
	}

	/**
	 * Get all events for a participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return EventParticipant[] Array of event-participant relationships.
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
				return new EventParticipant( $row );
			},
			$results
		);
	}

	/**
	 * Get specific relationship.
	 *
	 * @param int $event_id       Event ID.
	 * @param int $participant_id Participant ID.
	 * @return EventParticipant|null Relationship or null if not found.
	 */
	public function get_by_event_and_participant( $event_id, $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_id = %d AND participant_id = %d',
				$table_name,
				$event_id,
				$participant_id
			),
			ARRAY_A
		);

		return $result ? new EventParticipant( $result ) : null;
	}

	/**
	 * Add participant to event.
	 *
	 * @param int    $event_id       Event ID.
	 * @param int    $participant_id Participant ID.
	 * @param string $label          Label (interested or signed_up).
	 * @return int|false Relationship ID or false on failure.
	 */
	public function add_participant_to_event( $event_id, $participant_id, $label = 'interested' ) {
		$existing = $this->get_by_event_and_participant( $event_id, $participant_id );
		if ( $existing ) {
			return false; // Already exists.
		}

		$relationship = new EventParticipant(
			array(
				'event_id'       => $event_id,
				'participant_id' => $participant_id,
				'label'          => $label,
			)
		);

		return $relationship->save() ? $relationship->id : false;
	}

	/**
	 * Remove participant from event.
	 *
	 * @param int $event_id       Event ID.
	 * @param int $participant_id Participant ID.
	 * @return bool Success.
	 */
	public function remove_participant_from_event( $event_id, $participant_id ) {
		$relationship = $this->get_by_event_and_participant( $event_id, $participant_id );

		if ( ! $relationship ) {
			return false;
		}

		return $relationship->delete();
	}

	/**
	 * Update label for event-participant relationship.
	 *
	 * @param int    $event_id       Event ID.
	 * @param int    $participant_id Participant ID.
	 * @param string $label          New label.
	 * @return bool Success.
	 */
	public function update_label( $event_id, $participant_id, $label ) {
		$relationship = $this->get_by_event_and_participant( $event_id, $participant_id );

		if ( ! $relationship ) {
			return false;
		}

		$relationship->label = $label;
		return $relationship->save();
	}

	/**
	 * Get counts by label for an event.
	 *
	 * @param int $event_id Event ID.
	 * @return array Associative array with label counts.
	 */
	public function get_label_counts_for_event( $event_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT label, COUNT(*) as count FROM %i WHERE event_id = %d GROUP BY label',
				$table_name,
				$event_id
			),
			ARRAY_A
		);

		$counts = array(
			'interested'   => 0,
			'signed_up'    => 0,
			'collaborator' => 0,
		);

		foreach ( $results as $row ) {
			$counts[ $row['label'] ] = (int) $row['count'];
		}

		return $counts;
	}

	/**
	 * Get event counts by label for all participants.
	 *
	 * Returns an associative array keyed by participant_id, with each value
	 * containing counts for each label type.
	 *
	 * @return array Associative array: participant_id => ['interested' => n, 'signed_up' => n, 'collaborator' => n].
	 */
	public function get_event_counts_for_all_participants() {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT participant_id, label, COUNT(*) as count FROM %i GROUP BY participant_id, label',
				$table_name
			),
			ARRAY_A
		);

		$counts = array();

		foreach ( $results as $row ) {
			$participant_id = (int) $row['participant_id'];
			if ( ! isset( $counts[ $participant_id ] ) ) {
				$counts[ $participant_id ] = array(
					'interested'   => 0,
					'signed_up'    => 0,
					'collaborator' => 0,
				);
			}
			$counts[ $participant_id ][ $row['label'] ] = (int) $row['count'];
		}

		return $counts;
	}

	/**
	 * Get event counts by label for specific participants.
	 *
	 * @param array $participant_ids Array of participant IDs.
	 * @return array Associative array: participant_id => ['interested' => n, 'signed_up' => n, 'collaborator' => n].
	 */
	public function get_event_counts_for_participants( $participant_ids ) {
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
				"SELECT participant_id, label, COUNT(*) as count FROM %i WHERE participant_id IN ($placeholders) GROUP BY participant_id, label",
				array_merge( array( $table_name ), array_map( 'intval', $participant_ids ) )
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

		$counts = array();

		// Initialize all requested participants with zero counts.
		foreach ( $participant_ids as $id ) {
			$counts[ (int) $id ] = array(
				'interested'   => 0,
				'signed_up'    => 0,
				'collaborator' => 0,
			);
		}

		// Fill in actual counts.
		foreach ( $results as $row ) {
			$participant_id                             = (int) $row['participant_id'];
			$counts[ $participant_id ][ $row['label'] ] = (int) $row['count'];
		}

		return $counts;
	}
}
