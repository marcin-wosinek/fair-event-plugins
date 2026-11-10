<?php
/**
 * Event Ticket Statistics
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * Counts the confirmed tickets of one event occurrence for the Statistics
 * tab (#1725), and how their activities are spread.
 *
 * A confirmed ticket unit counts once, whoever holds it; unit status alone
 * decides, so cancelling or refunding one ticket of a purchase removes just
 * that one. Occurrence scope follows TicketCapacity: a
 * whole_series ticket counts on every occurrence of its series that starts
 * at or after its purchase.
 *
 * A confirmed signup not yet backfilled to ticket units still counts, by
 * its quantity, never on top of units. Activities count per ticket from
 * confirmed ticket selections.
 *
 * Only Events purchases and their ticket activities count (§8.14, #2251):
 * neither Fair Audience relationships nor participant-scope activities are
 * read, so Statistics work with Fair Audience inactive.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- scope clauses hold only code-defined column names and generated placeholders.
 */
class EventTicketStatistics {

	/**
	 * Calculate ticket statistics for an occurrence.
	 *
	 * @param \FairEvents\Models\EventDates $event_date Event occurrence.
	 * @return array{total: int, daily: array<string, int>, tickets_per_activity: array[], activities_per_ticket: array[], incomplete_ticket_backfills: int}
	 */
	public static function for_event_date( $event_date ) {
		$scope      = self::get_scope( $event_date );
		$tickets    = self::get_confirmed_tickets( $scope );
		$activities = self::get_ticket_activities( $scope );

		$units      = array();
		$incomplete = array();
		foreach ( $tickets as $ticket ) {
			$units[] = array(
				'count'      => 1,
				'date'       => substr( (string) $ticket['created_at'], 0, 10 ),
				'activities' => $activities[ (int) $ticket['id'] ] ?? array(),
			);
			if ( (int) $ticket['unit_rows'] < (int) $ticket['quantity'] ) {
				$incomplete[ (int) $ticket['signup_id'] ] = true;
			}
		}
		foreach ( self::get_unbackfilled_signups( $scope ) as $signup ) {
			$units[] = array(
				'count'      => (int) $signup['quantity'],
				'date'       => substr( (string) $signup['created_at'], 0, 10 ),
				'activities' => array(),
			);
		}

		$total        = 0;
		$daily        = array();
		$per_activity = array();
		$names        = array();
		$buckets      = array();
		foreach ( $units as $unit ) {
			$total                 += $unit['count'];
			$daily[ $unit['date'] ] = ( $daily[ $unit['date'] ] ?? 0 ) + $unit['count'];

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
			'total'                       => $total,
			'daily'                       => $daily,
			'tickets_per_activity'        => $tickets_per_activity,
			'activities_per_ticket'       => $activities_per_ticket,
			'incomplete_ticket_backfills' => count( $incomplete ),
		);
	}

	/**
	 * Describe which stored event dates an occurrence's admissions can come
	 * from. `start` is the latest purchase time at which a whole-series pass
	 * covers the occurrence (EventTiming::series_pass_cutoff()).
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
			'start'         => (string) \FairEvents\Helpers\EventTiming::series_pass_cutoff( $event_date->get_timing() ),
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
	 * @param array $scope Scope from get_scope().
	 * @return array[]
	 */
	private static function get_unbackfilled_signups( array $scope ) {
		global $wpdb;

		list( $clause, $args ) = self::scope_clause( $scope, 's.event_date_id', 's.created_at', $scope['start'] );

		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT s.id, s.participant_id, s.event_date_id, s.created_at, GREATEST( s.quantity, 1 ) AS quantity
				FROM %i AS s
				LEFT JOIN %i AS tt ON tt.id = s.ticket_type_id
				WHERE s.status = 'confirmed' AND NOT EXISTS ( SELECT 1 FROM %i AS t WHERE t.signup_id = s.id ) AND {$clause}",
				array_merge( array( self::signups_table(), self::ticket_types_table(), self::tickets_table() ), $args )
			),
			ARRAY_A
		);
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
