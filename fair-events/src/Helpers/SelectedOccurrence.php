<?php
/**
 * Resolve which event-date row to use for the current request.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * When a recurring event page is loaded with `?event_date=<id>`, sibling
 * blocks (event-info, event-dates, calendar-button) should render data for
 * that specific occurrence instead of the master row. This helper validates
 * the URL-provided id and falls back to the default row otherwise.
 */
class SelectedOccurrence {

	/**
	 * Resolve the event-date row to display for a given post.
	 *
	 * @param int                  $post_id Post ID to resolve the event for.
	 * @param EventDates|null|bool $default Optional pre-fetched default row.
	 *                                      `false` (the sentinel) means "fetch
	 *                                      it for me"; `null` is a legitimate
	 *                                      "no default exists" answer.
	 * @return EventDates|null
	 */
	public static function resolve( $post_id, $default = false ) {
		if ( false === $default ) {
			$default = EventDates::get_by_event_id( $post_id );
		}

		if ( ! $default ) {
			return null;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$candidate_id = isset( $_GET['event_date'] ) ? absint( wp_unslash( $_GET['event_date'] ) ) : 0;

		if ( $candidate_id > 0 ) {
			if ( $candidate_id === (int) $default->id ) {
				return $default;
			}

			$candidate = EventDates::get_by_id( $candidate_id );
			// Only accept candidates that belong to the same series as the
			// default row, i.e. generated children whose master_id points
			// to it. Prevents URL tampering from rendering an unrelated
			// event on this post's page. Invalid candidate IDs fall
			// through to the no-param default below.
			if ( $candidate && (int) $candidate->master_id === (int) $default->id ) {
				return self::with_master_venue_fallback( $candidate, $default );
			}
		}

		// No (valid) URL param: for recurring series, pivot to the closest
		// upcoming occurrence (the master itself if its own date is still in
		// the future, otherwise the next generated child) so all blocks on
		// the page describe the next-in-sequence date instead of the
		// abstract master row. Falls back to the master if no future
		// occurrences exist (e.g. series has fully ended).
		if ( 'master' === $default->occurrence_type ) {
			$upcoming = EventDates::get_upcoming_by_master_id( (int) $default->id );
			if ( ! empty( $upcoming ) ) {
				return self::with_master_venue_fallback( $upcoming[0], $default );
			}
		}

		return $default;
	}

	/**
	 * Hydrate venue fields on a generated child from its master when both
	 * venue_id and address are empty on the child.
	 *
	 * Generated children may lack venue_id/address when a venue was assigned
	 * to the master after the children were created, or before propagation
	 * logic existed. Patching the returned object here fixes all four render
	 * sites (event-info block, CalendarButtonHooks, OpenGraphHooks) without
	 * touching the underlying row.
	 *
	 * @param EventDates $child  Generated child occurrence.
	 * @param EventDates $master Master occurrence (already loaded).
	 * @return EventDates The child, with venue fields copied from master if absent.
	 */
	private static function with_master_venue_fallback( EventDates $child, EventDates $master ): EventDates {
		if ( 'generated' !== $child->occurrence_type ) {
			return $child;
		}

		if ( empty( $child->venue_id ) && empty( $child->address ) ) {
			$child->venue_id = $master->venue_id;
			$child->address  = $master->address;
		}

		return $child;
	}
}
