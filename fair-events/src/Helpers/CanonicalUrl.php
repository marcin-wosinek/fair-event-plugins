<?php
/**
 * Canonical URL resolution for recurring event occurrence pages.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * A recurring event's page can display any one of its occurrences via
 * `?event_date=`, and each occurrence shows genuinely different content
 * (date/time, location, structured data). Without a per-occurrence
 * canonical, search engines treat every occurrence as a duplicate of the
 * page's default view. This helper decides when a request's selected
 * occurrence needs its own canonical URL (differs from the page's default)
 * versus when it should collapse back to the plain page URL.
 */
class CanonicalUrl {

	/**
	 * Resolve the canonical URL for the current request against a post.
	 *
	 * @param int    $post_id  Post ID to resolve the event for.
	 * @param string $base_url The plain event page URL (WordPress' own canonical).
	 * @return string Canonical URL: $base_url unchanged, or $base_url with a
	 *                normalized `event_date` param for a non-default occurrence.
	 */
	public static function for_post( int $post_id, string $base_url ): string {
		$default = EventDates::get_by_event_id( $post_id );

		if ( ! $default ) {
			return $base_url;
		}

		$selected = SelectedOccurrence::resolve( $post_id, $default );
		if ( ! $selected ) {
			return $base_url;
		}

		$pivot = SelectedOccurrence::default_pivot( $default );

		return self::resolve_url( $base_url, $selected, $pivot );
	}

	/**
	 * Pure canonical-URL decision: same-id as the pivot collapses to the
	 * base URL, anything else gets its own normalized `event_date` param.
	 *
	 * @param string     $base_url The plain event page URL.
	 * @param EventDates $selected The occurrence resolved for this request.
	 * @param EventDates $pivot    The page's default occurrence.
	 * @return string Canonical URL.
	 */
	public static function resolve_url( string $base_url, EventDates $selected, EventDates $pivot ): string {
		if ( (int) $selected->id === (int) $pivot->id ) {
			return $base_url;
		}

		return add_query_arg( 'event_date', OccurrenceDateParam::format( $selected ), $base_url );
	}
}
