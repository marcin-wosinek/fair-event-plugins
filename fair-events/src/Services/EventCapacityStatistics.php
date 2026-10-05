<?php
/**
 * Event Capacity Statistics
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\TicketType;

defined( 'WPINC' ) || die;

/**
 * Reports the places currently taken against each configured limit of one
 * event occurrence, for the Statistics tab (#1711): the occurrence itself,
 * its ticket types and its activities.
 *
 * TicketCapacity is the counting authority, so these figures match ticket
 * availability: they include unexpired payment holds, which the confirmed
 * sales totals of EventTicketStatistics leave out.
 *
 * Ticket types and activities are configured on the series master. An
 * activity's limit applies to the selected occurrence on its own; a ticket
 * type's limit is one pool shared by every date of its series.
 *
 * Only aggregates are returned, never participant records.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventCapacityStatistics {

	/**
	 * Calculate capacity figures for an occurrence.
	 *
	 * @param \FairEvents\Models\EventDates $event_date Event occurrence.
	 * @return array{event_capacity: array, ticket_type_capacity: array[], activity_capacity: array[]}
	 */
	public static function for_event_date( $event_date ) {
		$event_date_id        = (int) $event_date->id;
		$config_event_date_id = ( 'generated' === $event_date->occurrence_type && ! empty( $event_date->master_id ) )
			? (int) $event_date->master_id
			: $event_date_id;
		$series_wide          = self::is_series( $config_event_date_id );

		$ticket_types = array();
		foreach ( TicketType::get_all_by_event_date_id( $config_event_date_id ) as $ticket_type ) {
			$ticket_types[] = array(
				'id'          => (int) $ticket_type->id,
				'name'        => (string) $ticket_type->name,
				'series_wide' => $series_wide,
			) + self::figures( TicketCapacity::count_ticket_type( (int) $ticket_type->id ), $ticket_type->capacity );
		}

		$activities = array();
		foreach ( \FairEvents\Models\TicketOption::get_all_by_event_date_id( $config_event_date_id ) as $option ) {
			$activities[] = array(
				'id'   => (int) $option->id,
				'name' => (string) $option->name,
			) + self::figures( TicketCapacity::count_ticket_option( (int) $option->id, $event_date_id ), $option->capacity );
		}

		return array(
			'event_capacity'       => self::figures( TicketCapacity::count_event_date( $event_date_id ), $event_date->capacity ),
			'ticket_type_capacity' => $ticket_types,
			'activity_capacity'    => $activities,
		);
	}

	/**
	 * Describe one scope: places taken against its limit.
	 *
	 * @param int      $taken    Places taken.
	 * @param int|null $capacity Configured limit, or null when unlimited.
	 * @return array{taken: int, capacity: int|null, remaining: int|null, over: int}
	 */
	private static function figures( int $taken, $capacity ) {
		if ( null === $capacity ) {
			return array(
				'taken'     => $taken,
				'capacity'  => null,
				'remaining' => null,
				'over'      => 0,
			);
		}

		$capacity = (int) $capacity;

		return array(
			'taken'     => $taken,
			'capacity'  => $capacity,
			'remaining' => max( 0, $capacity - $taken ),
			'over'      => max( 0, $taken - $capacity ),
		);
	}

	/**
	 * Whether an event date is the master of a series with other dates.
	 *
	 * @param int $master_id Series master (or single date) ID.
	 * @return bool
	 */
	private static function is_series( int $master_id ) {
		global $wpdb;

		return (bool) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT 1 FROM %i WHERE master_id = %d AND occurrence_type = 'generated' LIMIT 1",
				$wpdb->prefix . 'fair_event_dates',
				$master_id
			)
		);
	}
}
