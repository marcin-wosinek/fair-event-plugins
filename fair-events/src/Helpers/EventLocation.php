<?php
/**
 * Neutral event location resolution
 *
 * Resolves an event date's location into a schema-agnostic shape shared by
 * the public feed (JSON/ICS) and the Schema.org JSON-LD boundary, so both
 * follow the same fallback chain.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * Resolves EventDates rows into a neutral location shape.
 */
class EventLocation {

	/**
	 * Resolve an event date's location, following the same fallback chain as
	 * EventSchema::get_jsonld_location() minus the site-name backstop —
	 * callers here must be able to omit the field entirely.
	 *
	 * The physical side (name/address/latitude/longitude) is resolved
	 * independently of the attendance mode, then the mode decides which
	 * parts of the result are kept: `in_person` returns physical fields
	 * only, `online` returns the joining URL only, `hybrid` returns both.
	 *
	 * @param EventDates $event_date Event date object.
	 * @param int|null   $post_id    Linked post ID, or null for standalone events.
	 * @return array|null Neutral location shape (keys: mode, name, address,
	 *                     latitude, longitude, joining_url — all but `mode`
	 *                     optional), or null when nothing resolves.
	 */
	public static function resolve( EventDates $event_date, $post_id ) {
		$mode     = $event_date->attendance_mode ?? 'in_person';
		$physical = self::resolve_physical( $event_date, $post_id );

		$location = array( 'mode' => $mode );

		if ( 'in_person' === $mode || 'hybrid' === $mode ) {
			if ( null === $physical ) {
				if ( 'in_person' === $mode ) {
					return null;
				}
			} else {
				$location = array_merge( $location, $physical );
			}
		}

		if ( 'online' === $mode || 'hybrid' === $mode ) {
			$location['joining_url'] = ! empty( $event_date->joining_link )
				? $event_date->joining_link
				: $event_date->get_event_page_url();
		}

		return $location;
	}

	/**
	 * Resolve the physical side of a location (venue → free-text address →
	 * event_location meta), independent of attendance mode.
	 *
	 * @param EventDates $event_date Event date object.
	 * @param int|null   $post_id    Linked post ID, or null for standalone events.
	 * @return array|null Physical location shape (keys: name, address,
	 *                     latitude, longitude), or null when nothing resolves.
	 */
	private static function resolve_physical( EventDates $event_date, $post_id ) {
		// 1. Venue.
		if ( ! empty( $event_date->venue_id )
			&& class_exists( \FairEventsExperimental\Models\Venue::class ) ) {
			$venue = \FairEventsExperimental\Models\Venue::get_by_id( $event_date->venue_id );
			if ( $venue ) {
				$location = array( 'name' => $venue->name );

				if ( ! empty( $venue->address ) ) {
					$location['address'] = $venue->address;
				}

				if ( ! empty( $venue->latitude ) && ! empty( $venue->longitude ) ) {
					$location['latitude']  = $venue->latitude;
					$location['longitude'] = $venue->longitude;
				}

				return $location;
			}
		}

		// 2. Event date's own free-text address.
		if ( ! empty( $event_date->address ) ) {
			return array( 'address' => $event_date->address );
		}

		// 3. Fall back to event_location meta.
		$meta_location = $post_id ? get_post_meta( $post_id, 'event_location', true ) : '';
		if ( ! empty( $meta_location ) ) {
			return array( 'address' => $meta_location );
		}

		return null;
	}
}
