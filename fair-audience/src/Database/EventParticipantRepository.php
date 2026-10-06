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
	 * Get the minimal confirmed-sale fields for an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array[] Rows containing participant, ticket type, and creation date.
	 */
	public function get_confirmed_sales_rows( $event_date_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, participant_id, ticket_type_id, created_at
				 FROM %i
				 WHERE event_date_id = %d AND label = 'signed_up'
				 ORDER BY created_at ASC",
				$table_name,
				$event_date_id
			),
			ARRAY_A
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
	 * Make sure someone given a ticket has a relationship on its event date,
	 * so they are listed in the audience. An existing relationship is kept
	 * exactly as it is. A new one is created as 'interested': the ticket
	 * they hold, not the relationship, is what admits them, so it stops
	 * doing so the moment the ticket is taken back, cancelled or lapses.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return int|false Relationship ID, or false when it could not be created.
	 */
	public function ensure_ticket_holder_relationship( $event_date_id, $participant_id ) {
		$existing = $this->get_by_event_date_and_participant( $event_date_id, $participant_id );
		if ( $existing ) {
			return (int) $existing->id;
		}

		$event_date = class_exists( \FairEvents\Models\EventDates::class )
			? \FairEvents\Models\EventDates::get_by_id( (int) $event_date_id )
			: null;
		$event_id   = $event_date ? (int) $event_date->get_resolved_event_id() : 0;
		if ( ! $event_id ) {
			return false;
		}

		return $this->add_participant_to_event( $event_id, (int) $participant_id, 'interested', (int) $event_date_id );
	}

	/**
	 * Make sure the holder of a ticket moved to an event date is admitted
	 * there. A holder other than the purchaser is listed as for an assigned
	 * ticket (see ensure_ticket_holder_relationship()). A purchaser holding
	 * their own confirmed ticket is signed up: a new relationship says so,
	 * and one that only listed them as interested is raised to it. Every
	 * other existing relationship, with its role, comment, consent and
	 * history, is left exactly as it is.
	 *
	 * @param int  $event_date_id  Event date ID.
	 * @param int  $participant_id Holder participant ID.
	 * @param bool $signed_up      Whether the holder bought the ticket and it is confirmed.
	 * @return int|false Relationship ID, or false when it could not be written.
	 */
	public function ensure_ticket_admission( $event_date_id, $participant_id, $signed_up ) {
		if ( ! $signed_up ) {
			return $this->ensure_ticket_holder_relationship( $event_date_id, $participant_id );
		}

		$existing = $this->get_by_event_date_and_participant( $event_date_id, $participant_id );
		if ( $existing ) {
			if ( 'interested' === $existing->label && ! $this->update_label_by_event_date( $event_date_id, $participant_id, 'signed_up' ) ) {
				return false;
			}

			return (int) $existing->id;
		}

		$event_date = class_exists( \FairEvents\Models\EventDates::class )
			? \FairEvents\Models\EventDates::get_by_id( (int) $event_date_id )
			: null;
		$event_id   = $event_date ? (int) $event_date->get_resolved_event_id() : 0;
		if ( ! $event_id ) {
			return false;
		}

		return $this->add_participant_to_event( $event_id, (int) $participant_id, 'signed_up', (int) $event_date_id );
	}

	/**
	 * Bring a purchaser's relationship on an event date in line with the
	 * tickets left there after one was cancelled or moved away. With no
	 * active ticket they hold or bought on the date, a signed-up or
	 * awaiting-payment relationship becomes 'interested': the participant
	 * stays listed, with their identity, consent, comment and history, but
	 * is no longer admitted. A collaborator keeps that role.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Purchaser participant ID.
	 * @return bool False only when the relationship could not be written.
	 */
	public function reconcile_ticket_admission( $event_date_id, $participant_id ) {
		$relationship = $this->get_by_event_date_and_participant( $event_date_id, $participant_id );
		if ( ! $relationship || ! in_array( $relationship->label, array( 'signed_up', 'pending_payment' ), true ) ) {
			return true;
		}

		if ( \FairEvents\Models\EventTicket::count_active_for_participant( (int) $event_date_id, (int) $participant_id ) > 0 ) {
			return true;
		}

		return (bool) $this->update_label_by_event_date( $event_date_id, $participant_id, 'interested' );
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
	 * Set the ticket type on an event-participant relationship by event_date_id.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @param int $ticket_type_id New ticket type ID.
	 * @return bool Success.
	 */
	public function update_ticket_type_by_event_date( $event_date_id, $participant_id, $ticket_type_id ) {
		$relationship = $this->get_by_event_date_and_participant( $event_date_id, $participant_id );

		if ( ! $relationship ) {
			return false;
		}

		$relationship->ticket_type_id = (int) $ticket_type_id;
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
		$now        = gmdate( 'Y-m-d H:i:s' );

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
		$now        = gmdate( 'Y-m-d H:i:s' );

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
	 * Count active admissions that have no fair-events signup behind them:
	 * relationships from before ticket units, the retired fair-audience
	 * purchase route, or an organizer adding a participant by hand. They
	 * keep occupying capacity next to fair-events' ticket units. A
	 * relationship whose participant has a signup for the same event date
	 * or ticket type is already counted there and is skipped, so one
	 * admission never counts twice. So is one whose participant holds an
	 * active ticket on the date: a ticket assigned to them by its purchaser
	 * is counted as that ticket.
	 *
	 * @param string $scope 'event_date' or 'ticket_type'.
	 * @param int    $id    Event date ID or ticket type ID.
	 * @return int
	 */
	public function count_admissions_without_signup( $scope, $id ) {
		global $wpdb;

		$column = 'ticket_type' === $scope ? 'ticket_type_id' : 'event_date_id';

		$count = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i AS ep
				 WHERE ep.%i = %d
				 AND (
				     ep.label = 'signed_up'
				     OR ( ep.label = 'pending_payment' AND ep.payment_expires_at IS NOT NULL AND ep.payment_expires_at > %s )
				 )
				 AND NOT EXISTS (
				     SELECT 1 FROM %i AS s
				     WHERE s.participant_id = ep.participant_id
				     AND ( s.event_date_id = ep.event_date_id OR ( ep.ticket_type_id IS NOT NULL AND s.ticket_type_id = ep.ticket_type_id ) )
				 )
				 AND NOT EXISTS (
				     SELECT 1 FROM %i AS t
				     WHERE t.holder_participant_id = ep.participant_id
				     AND t.event_date_id = ep.event_date_id
				     AND t.status NOT IN ( 'failed', 'expired', 'cancelled', 'refunded' )
				 )",
				$this->get_table_name(),
				$column,
				(int) $id,
				gmdate( 'Y-m-d H:i:s' ),
				$wpdb->prefix . 'fair_events_signups',
				$wpdb->prefix . 'fair_events_tickets'
			)
		);

		return (int) $count;
	}

	/**
	 * Count the places an activity (ticket option) has taken on an event
	 * date.
	 *
	 * With per-ticket storage, fair-events counts every active ticket
	 * selecting the activity on that occurrence (sibling tickets of one
	 * purchase take one place each) plus the participant-level selections
	 * reported by count_participant_scope_selections() — see
	 * TicketCapacity::count_ticket_option(). Without it, each relationship
	 * holding the option counts once:
	 *
	 * - label = 'signed_up' or unexpired 'pending_payment', and
	 * - the junction row itself confirmed or an unexpired pending hold (an
	 *   add-on purchase in flight on an otherwise signed_up parent row).
	 *
	 * Used for per-activity capacity enforcement.
	 *
	 * @param int $ticket_option_id Ticket option ID.
	 * @param int $event_date_id    Occurrence (event date) the places are on; 0 for the option's own event date.
	 * @return int Number of places held against the option.
	 */
	public function count_signups_for_ticket_option( $ticket_option_id, $event_date_id = 0 ) {
		global $wpdb;

		$now = gmdate( 'Y-m-d H:i:s' );

		if ( ! \FairAudience\Services\TicketActivities::available() ) {
			$count = $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*)
					 FROM %i ep
					 INNER JOIN %i epo ON epo.event_participant_id = ep.id
					 WHERE epo.ticket_option_id = %d
					 AND (
					     ep.label = 'signed_up'
					     OR ( ep.label = 'pending_payment' AND ep.payment_expires_at IS NOT NULL AND ep.payment_expires_at > %s )
					 )
					 AND (
					     epo.status = 'confirmed'
					     OR ( epo.status = 'pending_payment' AND epo.expires_at IS NOT NULL AND epo.expires_at > %s )
					 )",
					$this->get_table_name(),
					$wpdb->prefix . 'fair_audience_event_participant_options',
					$ticket_option_id,
					$now,
					$now
				)
			);

			return (int) $count;
		}

		if ( ! $event_date_id ) {
			$event_date_id = (int) $wpdb->get_var(
				$wpdb->prepare(
					'SELECT event_date_id FROM %i WHERE id = %d',
					$wpdb->prefix . 'fair_events_ticket_options',
					$ticket_option_id
				)
			);
		}

		return \FairEvents\Services\TicketCapacity::count_ticket_option( (int) $ticket_option_id, (int) $event_date_id );
	}

	/**
	 * Count participant-level activity selections still holding a place on
	 * an occurrence: selections not attributed to a ticket, on an active
	 * relationship (signed_up, or pending_payment within its hold), the
	 * selection itself confirmed or an unexpired hold. A selection counts on
	 * its relationship's event date; one on a whole-series pass counts on
	 * every date of the series. Reported to fair-events through
	 * fair_events_capacity_legacy_activity_selections.
	 *
	 * @param int   $ticket_option_id Ticket option ID.
	 * @param int   $event_date_id    Occurrence (event date) ID.
	 * @param int[] $series_ids       Every event date of the occurrence's series.
	 * @return int
	 */
	public function count_participant_scope_selections( $ticket_option_id, $event_date_id, array $series_ids ) {
		global $wpdb;

		$series_ids = array_values( array_filter( array_map( 'intval', $series_ids ) ) );
		if ( ! $series_ids ) {
			$series_ids = array( (int) $event_date_id );
		}
		$now = gmdate( 'Y-m-d H:i:s' );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- placeholder list built here.
		$count = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*)
				 FROM %i ep
				 INNER JOIN %i epo ON epo.event_participant_id = ep.id
				 LEFT JOIN %i tt ON tt.id = ep.ticket_type_id
				 WHERE epo.ticket_option_id = %d
				 AND epo.ticket_id IS NULL
				 AND (
				     ep.label = 'signed_up'
				     OR ( ep.label = 'pending_payment' AND ep.payment_expires_at IS NOT NULL AND ep.payment_expires_at > %s )
				 )
				 AND (
				     epo.status = 'confirmed'
				     OR ( epo.status = 'pending_payment' AND epo.expires_at IS NOT NULL AND epo.expires_at > %s )
				 )
				 AND (
				     ep.event_date_id = %d
				     OR ( tt.recurrence_scope = 'whole_series' AND ep.event_date_id IN ( " . implode( ', ', array_fill( 0, count( $series_ids ), '%d' ) ) . ' ) )
				 )',
				array_merge(
					array(
						$this->get_table_name(),
						$wpdb->prefix . 'fair_audience_event_participant_options',
						$wpdb->prefix . 'fair_events_ticket_types',
						(int) $ticket_option_id,
						$now,
						$now,
						(int) $event_date_id,
					),
					$series_ids
				)
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		return (int) $count;
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
	 * Get the ticket option IDs a participant holds on an event date, across
	 * their tickets and participant scope, confirmed or pending. Use this to
	 * guard against re-adding/re-purchasing an option that already has a
	 * hold on it (confirmed or an in-flight payment).
	 *
	 * @param int $event_participant_id Event participant row ID.
	 * @return int[] Held ticket option IDs (any status).
	 */
	public function get_option_ids_for_event_participant( $event_participant_id ) {
		$event_participant = $this->get_by_id( $event_participant_id );
		if ( ! $event_participant ) {
			return array();
		}

		return array_values(
			array_unique(
				array_map(
					static fn( $row ) => (int) $row->ticket_option_id,
					$this->get_activity_rows( $event_participant )
				)
			)
		);
	}

	/**
	 * Get the ticket option IDs actually confirmed for a participant on an
	 * event date, across their tickets and participant scope — excludes
	 * rows still awaiting payment. Use this for anything the viewer sees as
	 * "yours" (e.g. "current activities" summary), so a payment still in
	 * flight is never displayed as already granted.
	 *
	 * @param int $event_participant_id Event participant row ID.
	 * @return int[] Confirmed ticket option IDs.
	 */
	public function get_confirmed_option_ids_for_event_participant( $event_participant_id ) {
		$event_participant = $this->get_by_id( $event_participant_id );
		if ( ! $event_participant ) {
			return array();
		}

		$option_ids = array();
		foreach ( $this->get_activity_rows( $event_participant ) as $row ) {
			if ( 'confirmed' === $row->status ) {
				$option_ids[] = (int) $row->ticket_option_id;
			}
		}

		return array_values( array_unique( $option_ids ) );
	}

	/**
	 * Get every activity a participant holds on a relationship's event date:
	 * participant-level rows not carried over to a ticket, then the
	 * activities of each ticket they hold there. A ticket still awaiting its
	 * purchase payment reports its activities as pending.
	 *
	 * @param EventParticipant $event_participant Relationship.
	 * @return object[] Rows with ticket_option_id, ticket_option_name, status, expires_at, ticket_id (null at participant scope), and over_capacity for a ticket's activity.
	 */
	public function get_activity_rows( $event_participant ) {
		$rows_by_relationship = $this->get_activity_rows_for_relationships( array( $event_participant ) );

		return $rows_by_relationship[ (int) $event_participant->id ] ?? array();
	}

	/**
	 * Bulk form of get_activity_rows().
	 *
	 * @param EventParticipant[] $event_participants Relationships.
	 * @return array<int, object[]> Rows keyed by relationship ID.
	 */
	public function get_activity_rows_for_relationships( array $event_participants ) {
		$rows_by_relationship = array();
		$ids                  = array();
		foreach ( $event_participants as $event_participant ) {
			$ids[] = (int) $event_participant->id;
			$rows_by_relationship[ (int) $event_participant->id ] = array();
		}
		if ( ! $ids ) {
			return array();
		}

		foreach ( $this->get_participant_scope_option_rows( $ids ) as $row ) {
			$rows_by_relationship[ (int) $row->event_participant_id ][] = (object) array(
				'ticket_option_id'   => (int) $row->ticket_option_id,
				'ticket_option_name' => (string) $row->ticket_option_name,
				'status'             => (string) $row->status,
				'expires_at'         => $row->expires_at,
				'ticket_id'          => null,
			);
		}

		foreach ( $this->get_tickets_for_relationships( $event_participants ) as $relationship_id => $tickets ) {
			$activities = \FairEvents\Models\EventTicketActivity::get_by_ticket_ids( wp_list_pluck( $tickets, 'id' ) );
			foreach ( $tickets as $ticket ) {
				foreach ( $activities[ (int) $ticket->id ] ?? array() as $activity ) {
					$rows_by_relationship[ $relationship_id ][] = (object) array(
						'ticket_option_id'   => (int) $activity->ticket_option_id,
						'ticket_option_name' => (string) $activity->ticket_option_name,
						'status'             => 'confirmed' === $ticket->status ? (string) $activity->status : 'pending_payment',
						'expires_at'         => $activity->expires_at,
						'ticket_id'          => (int) $ticket->id,
						'over_capacity'      => ! empty( $activity->over_capacity ),
					);
				}
			}
		}

		return $rows_by_relationship;
	}

	/**
	 * Get the active tickets each relationship's participant holds on the
	 * relationship's event date.
	 *
	 * @param EventParticipant[] $event_participants Relationships.
	 * @return array<int, object[]> Tickets keyed by relationship ID; empty when tickets are unavailable.
	 */
	public function get_tickets_for_relationships( array $event_participants ) {
		if ( ! \FairAudience\Services\TicketActivities::available() ) {
			return array();
		}

		$participants_by_date = array();
		foreach ( $event_participants as $event_participant ) {
			$participants_by_date[ (int) $event_participant->event_date_id ][] = (int) $event_participant->participant_id;
		}

		$tickets_by_date = array();
		foreach ( $participants_by_date as $event_date_id => $participant_ids ) {
			$tickets_by_date[ $event_date_id ] = \FairEvents\Models\EventTicket::get_held_by_participants( $event_date_id, $participant_ids );
		}

		$tickets_by_relationship = array();
		foreach ( $event_participants as $event_participant ) {
			$tickets = $tickets_by_date[ (int) $event_participant->event_date_id ][ (int) $event_participant->participant_id ] ?? array();
			if ( $tickets ) {
				$tickets_by_relationship[ (int) $event_participant->id ] = $tickets;
			}
		}

		return $tickets_by_relationship;
	}

	/**
	 * Get participant-level activity rows not carried over to a ticket.
	 *
	 * @param int[] $event_participant_ids Relationship IDs.
	 * @return object[]
	 */
	public function get_participant_scope_option_rows( array $event_participant_ids ) {
		global $wpdb;

		$event_participant_ids = array_values( array_filter( array_map( 'intval', $event_participant_ids ) ) );
		if ( ! $event_participant_ids ) {
			return array();
		}

		$placeholders = implode( ',', array_fill( 0, count( $event_participant_ids ), '%d' ) );
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE event_participant_id IN ($placeholders) AND ticket_id IS NULL ORDER BY id ASC",
				array_merge( array( $wpdb->prefix . 'fair_audience_event_participant_options' ), $event_participant_ids )
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

		return (array) $rows;
	}

	/**
	 * Attach ticket options to an event participant at participant scope.
	 * Idempotent: re-attaching an existing option only refreshes its
	 * snapshotted name and confirms it. A historical row already carried
	 * over to a ticket stays attributed, and the ticket's copy is confirmed.
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
			$wpdb->query(
				$wpdb->prepare(
					"INSERT INTO %i (event_participant_id, ticket_option_id, ticket_option_name, status, expires_at) VALUES (%d, %d, %s, 'confirmed', NULL)
					 ON DUPLICATE KEY UPDATE ticket_option_name = VALUES(ticket_option_name), status = 'confirmed', expires_at = NULL",
					$options_table,
					(int) $event_participant_id,
					(int) $option_id,
					(string) $option_name
				)
			);

			$attributed_ticket_id = (int) $wpdb->get_var(
				$wpdb->prepare(
					'SELECT ticket_id FROM %i WHERE event_participant_id = %d AND ticket_option_id = %d AND ticket_id IS NOT NULL',
					$options_table,
					(int) $event_participant_id,
					(int) $option_id
				)
			);
			if ( $attributed_ticket_id && \FairAudience\Services\TicketActivities::available() ) {
				\FairEvents\Models\EventTicketActivity::confirm( $attributed_ticket_id, array( $option ) );
			}
		}
	}

	/**
	 * Reserve ticket options against an event participant while their payment
	 * is in flight, without confirming them. Unlike add_options(), rows are
	 * written with status = 'pending_payment' and the given expiry, so
	 * count_signups_for_ticket_option() holds their capacity until either the
	 * payment confirms (add_options() re-writes the row as 'confirmed') or the
	 * hold expires and delete_expired_pending_options() releases it.
	 *
	 * Idempotent: re-reserving the same option (e.g. a retry) just refreshes
	 * its expiry.
	 *
	 * @param int    $event_participant_id Event participant row ID.
	 * @param array  $options              Array of objects/arrays with `id` and `name`.
	 * @param string $expires_at           MySQL datetime the hold expires at.
	 * @return void
	 */
	public function add_pending_options( $event_participant_id, $options, $expires_at ) {
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
			$wpdb->query(
				$wpdb->prepare(
					"INSERT INTO %i (event_participant_id, ticket_option_id, ticket_option_name, status, expires_at) VALUES (%d, %d, %s, 'pending_payment', %s)
					 ON DUPLICATE KEY UPDATE ticket_option_name = VALUES(ticket_option_name), status = 'pending_payment', expires_at = VALUES(expires_at)",
					$options_table,
					(int) $event_participant_id,
					(int) $option_id,
					(string) $option_name,
					$expires_at
				)
			);
		}
	}

	/**
	 * Release participant-level add-on holds for some options at once, e.g.
	 * when their payment could not be started or failed. Confirmed rows are
	 * untouched.
	 *
	 * @param int   $event_participant_id Event participant row ID.
	 * @param int[] $option_ids           Ticket option IDs.
	 * @return int Rows deleted.
	 */
	public function release_pending_options( $event_participant_id, array $option_ids ) {
		global $wpdb;

		$option_ids = array_values( array_unique( array_filter( array_map( 'intval', $option_ids ) ) ) );
		if ( ! $option_ids ) {
			return 0;
		}

		$placeholders = implode( ',', array_fill( 0, count( $option_ids ), '%d' ) );
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- placeholder list built above.
		$deleted = $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM %i WHERE event_participant_id = %d AND ticket_id IS NULL AND status = 'pending_payment' AND ticket_option_id IN ($placeholders)",
				array_merge( array( $wpdb->prefix . 'fair_audience_event_participant_options', (int) $event_participant_id ), $option_ids )
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		return (int) $deleted;
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
	 * EventSignup::has_confirmed_signup(). A participant holding a confirmed
	 * ticket there that someone else bought stays listed as 'interested',
	 * the label an assigned ticket's holder has.
	 *
	 * @return int Number of rows deleted.
	 */
	public function delete_expired_pending_payments() {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = gmdate( 'Y-m-d H:i:s' );

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
		$has_ticket_guard = \FairAudience\Services\TicketActivities::available();
		$deletable_ids    = array();

		foreach ( $candidates as $row ) {
			if ( $has_signup_guard
				&& \FairEvents\Models\EventSignup::has_confirmed_signup( (int) $row->event_date_id, (int) $row->participant_id )
			) {
				continue;
			}
			if ( $has_ticket_guard
				&& \FairEvents\Models\EventTicket::get_held_on_event_date( (int) $row->event_date_id, (int) $row->participant_id, array( 'confirmed' ) )
			) {
				$this->update_label_by_event_date( (int) $row->event_date_id, (int) $row->participant_id, 'interested' );
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
	 * Delete pending_payment junction rows whose expires_at has passed.
	 *
	 * Covers both participant-level holds and holds on individual tickets.
	 * Unlike delete_expired_pending_payments(), this never touches the parent
	 * event_participant row — an add-on hold sits on top of an already
	 * signed_up subscription, which stays valid throughout. Deleting just the
	 * junction row releases the option's capacity for a payment that never
	 * confirmed.
	 *
	 * @return int Number of rows deleted.
	 */
	public function delete_expired_pending_options() {
		global $wpdb;

		$options_table = $wpdb->prefix . 'fair_audience_event_participant_options';
		$now           = gmdate( 'Y-m-d H:i:s' );

		$deleted = $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM %i
				 WHERE status = 'pending_payment'
				 AND expires_at IS NOT NULL
				 AND expires_at <= %s",
				$options_table,
				$now
			)
		);

		// Add-on holds placed on individual tickets lapse the same way.
		if ( \FairAudience\Services\TicketActivities::available() ) {
			$deleted += \FairEvents\Models\EventTicketActivity::delete_expired_holds();
		}

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
