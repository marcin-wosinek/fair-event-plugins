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
 * When a recurring event page is loaded with `?event_date=<date>`, sibling
 * blocks (event-info, event-dates, calendar-button) should render data for
 * that specific occurrence instead of the master row. This helper validates
 * the URL-provided date (or, for legacy links, the numeric id) and falls
 * back to the default row otherwise.
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
		$raw_param = isset( $_GET['event_date'] ) ? sanitize_text_field( wp_unslash( $_GET['event_date'] ) ) : '';

		if ( '' !== $raw_param ) {
			$date = OccurrenceDateParam::parse( $raw_param );

			if ( null !== $date ) {
				$candidate = EventDates::get_by_master_id_and_date( (int) $default->id, $date );
				// A date not in this series returns null and falls through
				// to the no-param default below — the same anti-tampering
				// guarantee the legacy id check gives.
				if ( $candidate ) {
					return self::with_master_venue_fallback( $candidate, $default );
				}
			} elseif ( OccurrenceDateParam::is_legacy_id( $raw_param ) ) {
				// Legacy fallback: old `?event_date=<id>` links keep resolving.
				$candidate_id = absint( $raw_param );

				if ( $candidate_id === (int) $default->id ) {
					return $default;
				}

				$candidate = EventDates::get_by_id( $candidate_id );
				// Only accept candidates that belong to the same series as
				// the default row, i.e. generated children whose master_id
				// points to it. Prevents URL tampering from rendering an
				// unrelated event on this post's page.
				if ( $candidate && (int) $candidate->master_id === (int) $default->id ) {
					return self::with_master_venue_fallback( $candidate, $default );
				}
			}
		}

		// No (valid) URL param: for recurring series, prefer today's
		// occurrence if one exists, otherwise pivot to the closest upcoming
		// occurrence (the master itself if its own date is still in the
		// future, otherwise the next generated child) so all blocks on the
		// page describe the relevant date instead of the abstract master
		// row. Falls back to the master if no matching occurrences exist
		// (e.g. series has fully ended).
		if ( 'master' === $default->occurrence_type ) {
			$today    = EventDates::get_by_master_id_and_date( (int) $default->id, current_time( 'Y-m-d' ) );
			$upcoming = $today ? array() : EventDates::get_upcoming_by_master_id( (int) $default->id );
			$pivot    = self::pick_default_pivot( $today, $upcoming );

			if ( $pivot ) {
				return self::with_master_venue_fallback( $pivot, $default );
			}
		}

		return $default;
	}

	/**
	 * Choose which occurrence to pivot to when no URL param is present.
	 *
	 * Order: today's occurrence, then the closest upcoming one, else none
	 * (caller falls back to the master row itself).
	 *
	 * @param EventDates|null $today    Today's occurrence in the series, if any.
	 * @param EventDates[]    $upcoming Upcoming occurrences, ordered ascending.
	 * @return EventDates|null
	 */
	private static function pick_default_pivot( ?EventDates $today, array $upcoming ): ?EventDates {
		if ( $today ) {
			return $today;
		}

		return $upcoming[0] ?? null;
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
