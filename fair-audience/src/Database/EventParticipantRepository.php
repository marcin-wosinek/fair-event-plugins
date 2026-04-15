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
	 * Get all participants for an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return EventParticipant[] Array of event-participant relationships.
	 */
	public function get_by_event_date( $event_date_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d ORDER BY created_at ASC',
				$table_name,
				$event_date_id
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
	 * Get specific relationship by event_date_id and participant_id.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return EventParticipant|null Relationship or null if not found.
	 */
	public function get_by_event_date_and_participant( $event_date_id, $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d AND participant_id = %d',
				$table_name,
				$event_date_id,
				$participant_id
			),
			ARRAY_A
		);

		return $result ? new EventParticipant( $result ) : null;
	}

	/**
	 * Get specific relationship by event_id and participant_id (legacy compat).
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
	 * @param int    $event_date_id  Event date ID (resolved from event_id if 0).
	 * @return int|false Relationship ID or false on failure.
	 */
	public function add_participant_to_event( $event_id, $participant_id, $label = 'interested', $event_date_id = 0 ) {
		// Resolve event_date_id if not provided.
		if ( empty( $event_date_id ) && class_exists( \FairEvents\Models\EventDates::class ) ) {
			$event_dates_obj = \FairEvents\Models\EventDates::get_by_event_id( $event_id );
			if ( $event_dates_obj ) {
				$event_date_id = (int) $event_dates_obj->id;
			}
		}

		$existing = $this->get_by_event_date_and_participant( $event_date_id, $participant_id );
		if ( $existing ) {
			return false; // Already exists.
		}

		$relationship = new EventParticipant(
			array(
				'event_id'       => $event_id,
				'event_date_id'  => $event_date_id,
				'participant_id' => $participant_id,
				'label'          => $label,
			)
		);

		return $relationship->save() ? $relationship->id : false;
	}

	/**
	 * Remove participant from event by event_date_id.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return bool Success.
	 */
	public function remove_participant_from_event_date( $event_date_id, $participant_id ) {
		$relationship = $this->get_by_event_date_and_participant( $event_date_id, $participant_id );

		if ( ! $relationship ) {
			return false;
		}

		return $relationship->delete();
	}

	/**
	 * Remove participant from event by event_id (legacy compat).
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
	 * Update label for event-participant relationship by event_date_id.
	 *
	 * @param int    $event_date_id  Event date ID.
	 * @param int    $participant_id Participant ID.
	 * @param string $label          New label.
	 * @return bool Success.
	 */
	public function update_label_by_event_date( $event_date_id, $participant_id, $label ) {
		$relationship = $this->get_by_event_date_and_participant( $event_date_id, $participant_id );

		if ( ! $relationship ) {
			return false;
		}

		$relationship->label = $label;
		return $relationship->save();
	}

	/**
	 * Update label for event-participant relationship by event_id (legacy compat).
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
	 * Count active signups for an event date.
	 *
	 * Counts rows with label = 'signed_up' plus unexpired 'pending_payment' rows.
	 * Used for capacity enforcement: a pending payment row holds a slot until
	 * its payment_expires_at passes.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int Number of active signups holding a slot.
	 */
	public function count_active_for_event_date( $event_date_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = current_time( 'mysql' );

		$count = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COALESCE(SUM(seats), 0) FROM %i
				 WHERE event_date_id = %d
				 AND (
				     label = 'signed_up'
				     OR ( label = 'pending_payment' AND payment_expires_at IS NOT NULL AND payment_expires_at > %s )
				 )",
				$table_name,
				$event_date_id,
				$now
			)
		);

		return (int) $count;
	}

	/**
	 * Count active seats for a specific ticket type.
	 *
	 * Sums seats on rows with label = 'signed_up' plus unexpired
	 * 'pending_payment' rows filtered to one ticket type. Used for
	 * per-ticket-type capacity enforcement.
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return int Number of seats held against the ticket type.
	 */
	public function count_seats_for_ticket_type( $ticket_type_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = current_time( 'mysql' );

		$count = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COALESCE(SUM(seats), 0) FROM %i
				 WHERE ticket_type_id = %d
				 AND (
				     label = 'signed_up'
				     OR ( label = 'pending_payment' AND payment_expires_at IS NOT NULL AND payment_expires_at > %s )
				 )",
				$table_name,
				$ticket_type_id,
				$now
			)
		);

		return (int) $count;
	}

	/**
	 * Find an event participant row by its fair-payment transaction ID.
	 *
	 * @param int $transaction_id fair-payment transaction ID.
	 * @return EventParticipant|null Relationship or null.
	 */
	public function get_by_transaction_id( $transaction_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE transaction_id = %d LIMIT 1',
				$table_name,
				$transaction_id
			),
			ARRAY_A
		);

		return $result ? new EventParticipant( $result ) : null;
	}

	/**
	 * Delete pending_payment rows whose payment_expires_at has passed.
	 *
	 * @return int Number of rows deleted.
	 */
	public function delete_expired_pending_payments() {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = current_time( 'mysql' );

		$deleted = $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM %i
				 WHERE label = 'pending_payment'
				 AND payment_expires_at IS NOT NULL
				 AND payment_expires_at <= %s",
				$table_name,
				$now
			)
		);

		return (int) $deleted;
	}

	/**
	 * Get counts by label for an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Associative array with label counts.
	 */
	public function get_label_counts_for_event_date( $event_date_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT label, COUNT(*) as count FROM %i WHERE event_date_id = %d GROUP BY label',
				$table_name,
				$event_date_id
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
	 * Get counts by label for an event (by event_id).
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
