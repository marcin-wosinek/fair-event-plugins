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
	 * @param EventDates $event_date Event date object.
	 * @param int|null   $post_id    Linked post ID, or null for standalone events.
	 * @return array|null Neutral location shape (keys: name, address, latitude,
	 *                     longitude, online, url — all optional), or null when nothing resolves.
	 */
	public static function resolve( EventDates $event_date, $post_id ) {
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

		// 4. Online event: no physical location, but an external link.
		if ( 'external' === $event_date->link_type && ! empty( $event_date->external_url ) ) {
			return array(
				'online' => true,
				'url'    => $event_date->external_url,
			);
		}

		return null;
	}
}
