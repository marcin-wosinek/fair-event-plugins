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
		if ( $candidate_id <= 0 ) {
			return $default;
		}

		// Same row as default: nothing to swap.
		if ( $candidate_id === (int) $default->id ) {
			return $default;
		}

		$candidate = EventDates::get_by_id( $candidate_id );
		if ( ! $candidate ) {
			return $default;
		}

		// Only accept candidates that belong to the same series as the
		// default row, i.e. generated children whose master_id points to it.
		// This prevents URL tampering from rendering an unrelated event on
		// this post's page.
		if ( (int) $candidate->master_id !== (int) $default->id ) {
			return $default;
		}

		return $candidate;
	}
}
