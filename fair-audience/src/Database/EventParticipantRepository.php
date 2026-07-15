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
		if ( 'pending_payment' !== $label ) {
			$relationship->payment_expires_at = null;
		}
		return $relationship->save();
	}

	/**
	 * Mark participant as attended (or not) by event_date_id.
	 *
	 * Sets attended_at to the current timestamp when $attended is true, or
	 * NULL when false. Idempotent: when $attended is true and attended_at
	 * is already set, the existing timestamp is preserved.
	 *
	 * @param int  $event_date_id  Event date ID.
	 * @param int  $participant_id Participant ID.
	 * @param bool $attended       Whether the participant has shown up.
	 * @return bool Success.
	 */
	public function update_attended_at_by_event_date( $event_date_id, $participant_id, $attended ) {
		$relationship = $this->get_by_event_date_and_participant( $event_date_id, $participant_id );

		if ( ! $relationship ) {
			return false;
		}

		if ( $attended ) {
			if ( empty( $relationship->attended_at ) ) {
				$relationship->attended_at = current_time( 'mysql' );
			}
		} else {
			$relationship->attended_at = null;
		}

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
				"SELECT COUNT(*) FROM %i
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
	 * Count active signups for a specific ticket type.
	 *
	 * Counts rows with label = 'signed_up' plus unexpired
	 * 'pending_payment' rows filtered to one ticket type. Used for
	 * per-ticket-type capacity enforcement.
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return int Number of signups held against the ticket type.
	 */
	public function count_signups_for_ticket_type( $ticket_type_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = current_time( 'mysql' );

		$count = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i
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
	 * Count active signups reserved for a specific ticket option (activity).
	 *
	 * Counts event_participant rows that have an entry in the
	 * fair_audience_event_participant_options junction table for the given
	 * option, restricted to rows with label = 'signed_up' or unexpired
	 * 'pending_payment'. Used for per-activity capacity enforcement.
	 *
	 * @param int $ticket_option_id Ticket option ID.
	 * @return int Number of signups held against the option.
	 */
	public function count_signups_for_ticket_option( $ticket_option_id ) {
		global $wpdb;

		$participants_table = $this->get_table_name();
		$options_table      = $wpdb->prefix . 'fair_audience_event_participant_options';
		$now                = current_time( 'mysql' );

		$count = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*)
				 FROM %i ep
				 INNER JOIN %i epo ON epo.event_participant_id = ep.id
				 WHERE epo.ticket_option_id = %d
				 AND (
				     ep.label = 'signed_up'
				     OR ( ep.label = 'pending_payment' AND ep.payment_expires_at IS NOT NULL AND ep.payment_expires_at > %s )
				 )",
				$participants_table,
				$options_table,
				$ticket_option_id,
				$now
			)
		);

		return (int) $count;
	}

	/**
	 * Find an event participant row by its fair-payments-connector transaction ID.
	 *
	 * @param int $transaction_id fair-payments-connector transaction ID.
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
	 * Find all event participant rows sharing a fair-payments-connector
	 * transaction ID. A 'multiple_instances' ticket-type purchase creates one
	 * row per chosen occurrence under a single transaction; every other
	 * signup path creates exactly one row, so this is a superset of
	 * get_by_transaction_id() safe to use wherever "the rows this payment
	 * covers" is needed.
	 *
	 * @param int $transaction_id fair-payments-connector transaction ID.
	 * @return EventParticipant[] Relationships (empty array when none match).
	 */
	public function get_all_by_transaction_id( $transaction_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE transaction_id = %d',
				$table_name,
				$transaction_id
			),
			ARRAY_A
		);

		if ( empty( $results ) ) {
			return array();
		}

		return array_map(
			static function ( $row ) {
				return new EventParticipant( $row );
			},
			$results
		);
	}

	/**
	 * Find an event participant row by its primary key.
	 *
	 * @param int $id Event participant row ID.
	 * @return EventParticipant|null Relationship or null.
	 */
	public function get_by_id( $id ) {
		global $wpdb;

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d LIMIT 1',
				$this->get_table_name(),
				$id
			),
			ARRAY_A
		);

		return $result ? new EventParticipant( $result ) : null;
	}

	/**
	 * Get the ticket option IDs currently attached to an event participant.
	 *
	 * @param int $event_participant_id Event participant row ID.
	 * @return int[] Attached ticket option IDs.
	 */
	public function get_option_ids_for_event_participant( $event_participant_id ) {
		global $wpdb;

		$options_table = $wpdb->prefix . 'fair_audience_event_participant_options';

		$ids = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT ticket_option_id FROM %i WHERE event_participant_id = %d',
				$options_table,
				$event_participant_id
			)
		);

		return array_map( 'intval', (array) $ids );
	}

	/**
	 * Attach ticket options to an event participant. Idempotent: uses REPLACE
	 * so re-attaching an existing option only refreshes its snapshotted name.
	 *
	 * @param int   $event_participant_id Event participant row ID.
	 * @param array $options              Array of objects/arrays with `id` and `name`.
	 * @return void
	 */
	public function add_options( $event_participant_id, $options ) {
		global $wpdb;

		if ( empty( $options ) ) {
			return;
		}

		$options_table = $wpdb->prefix . 'fair_audience_event_participant_options';

		foreach ( $options as $option ) {
			$option_id   = is_array( $option ) ? ( $option['id'] ?? 0 ) : ( $option->id ?? 0 );
			$option_name = is_array( $option ) ? ( $option['name'] ?? '' ) : ( $option->name ?? '' );
			if ( ! $option_id ) {
				continue;
			}
			$wpdb->replace(
				$options_table,
				array(
					'event_participant_id' => (int) $event_participant_id,
					'ticket_option_id'     => (int) $option_id,
					'ticket_option_name'   => (string) $option_name,
				),
				array( '%d', '%d', '%s' )
			);
		}
	}

	/**
	 * Get the signed_up row on a master event-date for a participant, if one exists.
	 *
	 * Used by the series-pass resolver to check whether a participant holds a
	 * whole-series pass. The caller is responsible for verifying that the
	 * returned row's ticket_type has recurrence_scope = 'whole_series'.
	 *
	 * @param int $master_event_date_id Master event-date ID.
	 * @param int $participant_id       Participant ID.
	 * @return EventParticipant|null Signed-up row on the master, or null.
	 */
	public function get_series_pass_for_participant( $master_event_date_id, $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE event_date_id = %d AND participant_id = %d AND label = 'signed_up' LIMIT 1",
				$table_name,
				$master_event_date_id,
				$participant_id
			),
			ARRAY_A
		);

		return $result ? new EventParticipant( $result ) : null;
	}

	/**
	 * Delete pending_payment rows whose payment_expires_at has passed.
	 *
	 * Skips rows whose participant already holds a confirmed signup on the
	 * same event date (e.g. a series pass bought after this hold), so the
	 * cleanup never drops a still-relevant relationship — see
	 * EventSignup::has_confirmed_signup().
	 *
	 * @return int Number of rows deleted.
	 */
	public function delete_expired_pending_payments() {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = current_time( 'mysql' );

		$candidates = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, event_date_id, participant_id FROM %i
				 WHERE label = 'pending_payment'
				 AND payment_expires_at IS NOT NULL
				 AND payment_expires_at <= %s",
				$table_name,
				$now
			)
		);

		if ( empty( $candidates ) ) {
			return 0;
		}

		$has_signup_guard = class_exists( \FairEvents\Models\EventSignup::class );
		$deletable_ids    = array();

		foreach ( $candidates as $row ) {
			if ( $has_signup_guard
				&& \FairEvents\Models\EventSignup::has_confirmed_signup( (int) $row->event_date_id, (int) $row->participant_id )
			) {
				continue;
			}
			$deletable_ids[] = (int) $row->id;
		}

		if ( empty( $deletable_ids ) ) {
			return 0;
		}

		$placeholders = implode( ',', array_fill( 0, count( $deletable_ids ), '%d' ) );
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
		$deleted = $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM %i WHERE id IN ($placeholders)",
				array_merge( array( $table_name ), $deletable_ids )
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

		return (int) $deleted;
	}

	/**
	 * Move a participant's signup from one event date to another.
	 *
	 * Re-points the link row's event_date_id in place, preserving label,
	 * attended_at, ticket options, admin comment, and payment fields (they
	 * reference the row id, not the event_date_id).
	 *
	 * @param int $event_date_id        Source event date ID.
	 * @param int $participant_id       Participant ID.
	 * @param int $target_event_date_id Target event date ID.
	 * @return string 'success', 'not_found' (no source link), or 'conflict' (target already has this participant).
	 */
	public function move_to_event_date( $event_date_id, $participant_id, $target_event_date_id ) {
		global $wpdb;

		$relationship = $this->get_by_event_date_and_participant( $event_date_id, $participant_id );
		if ( ! $relationship ) {
			return 'not_found';
		}

		if ( $this->get_by_event_date_and_participant( $target_event_date_id, $participant_id ) ) {
			return 'conflict';
		}

		$result = $wpdb->update(
			$this->get_table_name(),
			array( 'event_date_id' => $target_event_date_id ),
			array( 'id' => $relationship->id ),
			array( '%d' ),
			array( '%d' )
		);

		return false !== $result ? 'success' : 'not_found';
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
