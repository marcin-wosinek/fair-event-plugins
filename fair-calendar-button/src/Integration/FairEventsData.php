<?php
/**
 * Event data from Fair Events for synchronized calendar buttons
 *
 * @package FairCalendarButton
 */

namespace FairCalendarButton\Integration;

defined( 'WPINC' ) || die;

/**
 * Reads a post's current event data from Fair Events, when it is active.
 *
 * Mirrors the editor's `utils/eventSync.js`: the post's primary event date,
 * exported only when it is calendar exportable, and the location from the
 * venue or the event date's own address.
 */
class FairEventsData {

	/**
	 * Calendar values for an event post.
	 *
	 * Timed values are site-local `Y-m-d\TH:i`, all-day values `Y-m-d` with
	 * an inclusive end date, matching the block's own attributes.
	 *
	 * @param int $post_id Event post ID.
	 * @return array{start: string, end: string, allDay: bool, location: string}|null
	 *         Calendar values, or null when Fair Events is not active, the
	 *         post has no event date, or its timing is not exportable.
	 */
	public static function calendar_values( $post_id ) {
		if ( ! class_exists( '\FairEvents\Models\EventDates' )
			|| ! class_exists( '\FairEvents\Helpers\EventTiming' ) ) {
			return null;
		}

		$event_date = \FairEvents\Models\EventDates::get_by_event_id( (int) $post_id );
		if ( ! $event_date ) {
			return null;
		}

		$timing = $event_date->get_timing();
		if ( ! \FairEvents\Helpers\EventTiming::is_calendar_exportable( $timing ) ) {
			return null;
		}

		$end_date = $timing['end_date'] ?? $timing['start_date'];

		if ( $timing['all_day'] ) {
			$start = $timing['start_date'];
			$end   = $end_date;
		} else {
			$start = $timing['start_date'] . 'T' . substr( $timing['start_time'], 0, 5 );
			$end   = $end_date . 'T' . substr( $timing['end_time'], 0, 5 );
		}

		return array(
			'start'    => $start,
			'end'      => $end,
			'allDay'   => (bool) $timing['all_day'],
			'location' => self::location( $event_date ),
		);
	}

	/**
	 * The event's location: the venue's name and address, or the event
	 * date's inline address when no venue is selected.
	 *
	 * @param object $event_date Fair Events event date.
	 * @return string Location, empty when the event has none.
	 */
	private static function location( $event_date ) {
		if ( ! empty( $event_date->venue_id ) && class_exists( '\FairEvents\Models\Venue' ) ) {
			$venue = \FairEvents\Models\Venue::get_by_id( $event_date->venue_id );
			if ( $venue && ! empty( $venue->name ) ) {
				return empty( $venue->address )
					? $venue->name
					: $venue->name . ', ' . $venue->address;
			}
		}

		return empty( $event_date->address ) ? '' : (string) $event_date->address;
	}
}
