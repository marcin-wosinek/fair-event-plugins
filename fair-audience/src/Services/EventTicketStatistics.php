<?php
/**
 * Event Ticket Statistics
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Counts the confirmed tickets of one event occurrence for the Statistics
 * tab (#1725), and how their activities are spread.
 *
 * A confirmed ticket unit counts once, whoever holds it; unit status alone
 * decides, so cancelling or refunding one ticket of a purchase removes just
 * that one. Occurrence scope follows fair-events' TicketCapacity: a
 * whole_series ticket counts on every occurrence of its series that starts
 * at or after its purchase.
 *
 * Two kinds of admission without ticket units still count, never on top of
 * units: a confirmed signup not yet backfilled (by its quantity), and a
 * signed-up relationship with no signup behind it (as one ticket).
 *
 * Activities count per ticket from confirmed ticket selections. Historical
 * selections recorded per participant are attributed only when the
 * participant holds exactly one ticket on that event date; otherwise those
 * tickets are left out of the activity charts and reported instead of
 * guessing which ticket chose what.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- scope clauses hold only code-defined column names and generated placeholders.
 */
class EventTicketStatistics {

	/**
	 * Calculate ticket statistics for an occurrence.
	 *
	 * @param \FairEvents\Models\EventDates $event_date Event occurrence.
	 * @return array{total: int, daily: array<string, int>, tickets_per_activity: array[], activities_per_ticket: array[], tickets_without_activity_assignment: int, incomplete_ticket_backfills: int}
	 */
	public static function for_event_date( $event_date ) {
		$scope       = self::get_scope( $event_date );
		$has_tickets = TicketActivities::available();
		$tickets     = $has_tickets ? self::get_confirmed_tickets( $scope ) : array();
		$activities  = $has_tickets ? self::get_ticket_activities( $scope ) : array();

		$units      = array();
		$incomplete = array();
		foreach ( $tickets as $ticket ) {
			$units[] = array(
				'key'        => self::participant_key( $ticket['participant_id'], $ticket['event_date_id'] ),
				'count'      => 1,
				'date'       => substr( (string) $ticket['created_at'], 0, 10 ),
				'activities' => $activities[ (int) $ticket['id'] ] ?? array(),
			);
			if ( (int) $ticket['unit_rows'] < (int) $ticket['quantity'] ) {
				$incomplete[ (int) $ticket['signup_id'] ] = true;
			}
		}
		foreach ( self::get_unbackfilled_signups( $scope, $has_tickets ) as $signup ) {
			$units[] = array(
				'key'        => self::participant_key( $signup['participant_id'], $signup['event_date_id'] ),
				'count'      => (int) $signup['quantity'],
				'date'       => substr( (string) $signup['created_at'], 0, 10 ),
				'activities' => array(),
			);
		}
		foreach ( self::get_relationships_without_signup( $scope ) as $relationship ) {
			// Relationship timestamps come from the database clock (UTC).
			$units[] = array(
				'key'        => self::participant_key( $relationship['participant_id'], $relationship['event_date_id'] ),
				'count'      => 1,
				'date'       => get_date_from_gmt( (string) $relationship['created_at'], 'Y-m-d' ),
				'activities' => array(),
			);
		}

		$tickets_per_key = array();
		foreach ( $units as $unit ) {
			if ( $unit['key'] ) {
				$tickets_per_key[ $unit['key'] ] = ( $tickets_per_key[ $unit['key'] ] ?? 0 ) + $unit['count'];
			}
		}
		$participant_selections = self::get_participant_scope_selections( $scope );

		$total        = 0;
		$daily        = array();
		$per_activity = array();
		$names        = array();
		$buckets      = array();
		$unassigned   = 0;
		foreach ( $units as $unit ) {
			$total                 += $unit['count'];
			$daily[ $unit['date'] ] = ( $daily[ $unit['date'] ] ?? 0 ) + $unit['count'];
			$selections             = $unit['key'] ? ( $participant_selections[ $unit['key'] ] ?? array() ) : array();
			if ( $selections ) {
				if ( 1 !== $tickets_per_key[ $unit['key'] ] ) {
					$unassigned += $unit['count'];
					continue;
				}
				$unit['activities'] += $selections;
			}

			$activity_count             = count( $unit['activities'] );
			$buckets[ $activity_count ] = ( $buckets[ $activity_count ] ?? 0 ) + $unit['count'];
			foreach ( $unit['activities'] as $option_id => $name ) {
				$per_activity[ $option_id ] = ( $per_activity[ $option_id ] ?? 0 ) + $unit['count'];
				if ( '' === ( $names[ $option_id ] ?? '' ) ) {
					$names[ $option_id ] = $name;
				}
			}
		}
		ksort( $daily );

		$tickets_per_activity = array();
		foreach ( $per_activity as $option_id => $count ) {
			$tickets_per_activity[] = array(
				'id'    => (int) $option_id,
				'name'  => (string) $names[ $option_id ],
				'count' => $count,
			);
		}
		usort(
			$tickets_per_activity,
			static fn( $a, $b ) => array( $b['count'], $a['name'], $a['id'] ) <=> array( $a['count'], $b['name'], $b['id'] )
		);

		$activities_per_ticket = array();
		if ( $buckets ) {
			for ( $activities_held = 0, $max = max( array_keys( $buckets ) ); $activities_held <= $max; $activities_held++ ) {
				$activities_per_ticket[] = array(
					'activities' => $activities_held,
					'tickets'    => $buckets[ $activities_held ] ?? 0,
				);
			}
		}

		return array(
			'total'                               => $total,
			'daily'                               => $daily,
			'tickets_per_activity'                => $tickets_per_activity,
			'activities_per_ticket'               => $activities_per_ticket,
			'tickets_without_activity_assignment' => $unassigned,
			'incomplete_ticket_backfills'         => count( $incomplete ),
		);
	}

	/**
	 * Describe which stored event dates an occurrence's admissions can come
	 * from.
	 *
	 * @param \FairEvents\Models\EventDates $event_date Event occurrence.
	 * @return array{event_date_id: int, series_ids: int[], start: string}
	 */
	private static function get_scope( $event_date ) {
		global $wpdb;

		$master_id = ( 'generated' === $event_date->occurrence_type && ! empty( $event_date->master_id ) )
			? (int) $event_date->master_id
			: (int) $event_date->id;

		$series_ids = array_map(
			'intval',
			$wpdb->get_col(
				$wpdb->prepare(
					"SELECT id FROM %i WHERE id = %d OR ( master_id = %d AND occurrence_type = 'generated' ) ORDER BY id ASC",
					$wpdb->prefix . 'fair_event_dates',
					$master_id,
					$master_id
				)
			)
		);

		return array(
			'event_date_id' => (int) $event_date->id,
			'series_ids'    => $series_ids,
			'start'         => (string) $event_date->start_datetime,
		);
	}

	/**
	 * Build the WHERE fragment selecting admissions that apply to the
	 * occurrence. Expects the ticket types table joined as `tt`.
	 *
	 * @param array  $scope       Scope from get_scope().
	 * @param string $date_column Column holding the stored event date.
	 * @param string $created_col Column holding the purchase time.
	 * @param string $start       Occurrence start in the purchase column's time zone.
	 * @return array{0: string, 1: array} SQL fragment and its arguments.
	 */
	private static function scope_clause( array $scope, $date_column, $created_col, $start ) {
		if ( count( $scope['series_ids'] ) < 2 ) {
			return array( "{$date_column} = %d", array( $scope['event_date_id'] ) );
		}

		return array(
			"( ( {$date_column} = %d AND ( tt.recurrence_scope IS NULL OR tt.recurrence_scope <> 'whole_series' ) )
			OR ( tt.recurrence_scope = 'whole_series' AND {$created_col} <= %s AND {$date_column} IN ( " . implode( ', ', array_fill( 0, count( $scope['series_ids'] ), '%d' ) ) . ' ) ) )',
			array_merge( array( $scope['event_date_id'], $start ), $scope['series_ids'] ),
		);
	}

	/**
	 * Confirmed ticket units that apply to the occurrence.
	 *
	 * @param array $scope Scope from get_scope().
	 * @return array[]
	 */
	private static function get_confirmed_tickets( array $scope ) {
		global $wpdb;

		list( $clause, $args ) = self::scope_clause( $scope, 't.event_date_id', 's.created_at', $scope['start'] );

		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT t.id, t.signup_id, s.participant_id, s.event_date_id, s.created_at,
					GREATEST( s.quantity, 1 ) AS quantity,
					( SELECT COUNT(*) FROM %i AS units WHERE units.signup_id = t.signup_id ) AS unit_rows
				FROM %i AS t
				INNER JOIN %i AS s ON s.id = t.signup_id
				LEFT JOIN %i AS tt ON tt.id = t.ticket_type_id
				WHERE t.status = 'confirmed' AND {$clause}
				ORDER BY t.id ASC",
				array_merge(
					array( self::tickets_table(), self::tickets_table(), self::signups_table(), self::ticket_types_table() ),
					$args
				)
			),
			ARRAY_A
		);
	}

	/**
	 * Confirmed activities on confirmed ticket units that apply to the
	 * occurrence, keyed by ticket ID, then ticket option ID.
	 *
	 * @param array $scope Scope from get_scope().
	 * @return array<int, array<int, string>> Activity name snapshots.
	 */
	private static function get_ticket_activities( array $scope ) {
		global $wpdb;

		list( $clause, $args ) = self::scope_clause( $scope, 't.event_date_id', 's.created_at', $scope['start'] );

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT ta.ticket_id, ta.ticket_option_id, ta.ticket_option_name
				FROM %i AS ta
				INNER JOIN %i AS t ON t.id = ta.ticket_id
				INNER JOIN %i AS s ON s.id = t.signup_id
				LEFT JOIN %i AS tt ON tt.id = t.ticket_type_id
				WHERE ta.status = 'confirmed' AND t.status = 'confirmed' AND {$clause}",
				array_merge(
					array( $wpdb->prefix . 'fair_events_ticket_activities', self::tickets_table(), self::signups_table(), self::ticket_types_table() ),
					$args
				)
			),
			ARRAY_A
		);

		$activities = array();
		foreach ( $rows as $row ) {
			$activities[ (int) $row['ticket_id'] ][ (int) $row['ticket_option_id'] ] = (string) $row['ticket_option_name'];
		}
		return $activities;
	}

	/**
	 * Confirmed signups that have no ticket units yet.
	 *
	 * @param array $scope       Scope from get_scope().
	 * @param bool  $has_tickets Whether fair-events stores ticket units.
	 * @return array[]
	 */
	private static function get_unbackfilled_signups( array $scope, $has_tickets ) {
		global $wpdb;

		list( $clause, $args ) = self::scope_clause( $scope, 's.event_date_id', 's.created_at', $scope['start'] );
		$tables                = array( self::signups_table(), self::ticket_types_table() );
		$without_units         = '';
		if ( $has_tickets ) {
			$without_units = 'AND NOT EXISTS ( SELECT 1 FROM %i AS t WHERE t.signup_id = s.id )';
			$tables[]      = self::tickets_table();
		}

		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT s.id, s.participant_id, s.event_date_id, s.created_at, GREATEST( s.quantity, 1 ) AS quantity
				FROM %i AS s
				LEFT JOIN %i AS tt ON tt.id = s.ticket_type_id
				WHERE s.status = 'confirmed' {$without_units} AND {$clause}",
				array_merge( $tables, $args )
			),
			ARRAY_A
		);
	}

	/**
	 * Signed-up relationships with no fair-events signup behind them, using
	 * the same matching as the capacity bridge
	 * (EventParticipantRepository::count_admissions_without_signup()).
	 *
	 * @param array $scope Scope from get_scope().
	 * @return array[]
	 */
	private static function get_relationships_without_signup( array $scope ) {
		global $wpdb;

		list( $clause, $args ) = self::scope_clause( $scope, 'ep.event_date_id', 'ep.created_at', get_gmt_from_date( $scope['start'] ) );

		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT ep.id, ep.participant_id, ep.event_date_id, ep.created_at
				FROM %i AS ep
				LEFT JOIN %i AS tt ON tt.id = ep.ticket_type_id
				WHERE ep.label = 'signed_up'
				AND NOT EXISTS (
					SELECT 1 FROM %i AS s
					WHERE s.participant_id = ep.participant_id
					AND ( s.event_date_id = ep.event_date_id OR ( ep.ticket_type_id IS NOT NULL AND s.ticket_type_id = ep.ticket_type_id ) )
				)
				AND {$clause}",
				array_merge(
					array( $wpdb->prefix . 'fair_audience_event_participants', self::ticket_types_table(), self::signups_table() ),
					$args
				)
			),
			ARRAY_A
		);
	}

	/**
	 * Confirmed activities still recorded per participant on the
	 * occurrence's series, keyed by participant_key(), then option ID.
	 *
	 * @param array $scope Scope from get_scope().
	 * @return array<string, array<int, string>> Activity name snapshots.
	 */
	private static function get_participant_scope_selections( array $scope ) {
		global $wpdb;

		$event_date_ids = count( $scope['series_ids'] ) < 2 ? array( $scope['event_date_id'] ) : $scope['series_ids'];

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT ep.participant_id, ep.event_date_id, epo.ticket_option_id, epo.ticket_option_name
				FROM %i AS ep
				INNER JOIN %i AS epo ON epo.event_participant_id = ep.id
				WHERE ep.label = 'signed_up' AND epo.status = 'confirmed' AND epo.ticket_id IS NULL
				AND ep.event_date_id IN ( " . implode( ', ', array_fill( 0, count( $event_date_ids ), '%d' ) ) . ' )',
				array_merge(
					array( $wpdb->prefix . 'fair_audience_event_participants', $wpdb->prefix . 'fair_audience_event_participant_options' ),
					$event_date_ids
				)
			),
			ARRAY_A
		);

		$selections = array();
		foreach ( $rows as $row ) {
			$key = self::participant_key( $row['participant_id'], $row['event_date_id'] );
			$selections[ $key ][ (int) $row['ticket_option_id'] ] = (string) $row['ticket_option_name'];
		}
		return $selections;
	}

	/**
	 * Identify a participant's admissions stored on one event date, or null
	 * when the purchase has no participant.
	 *
	 * @param int|string|null $participant_id Participant ID.
	 * @param int|string      $event_date_id  Stored event date ID.
	 * @return string|null
	 */
	private static function participant_key( $participant_id, $event_date_id ) {
		return $participant_id ? (int) $participant_id . ':' . (int) $event_date_id : null;
	}

	/**
	 * Tickets table.
	 *
	 * @return string
	 */
	private static function tickets_table() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_tickets';
	}

	/**
	 * Signups table.
	 *
	 * @return string
	 */
	private static function signups_table() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_signups';
	}

	/**
	 * Ticket types table.
	 *
	 * @return string
	 */
	private static function ticket_types_table() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_ticket_types';
	}
}
