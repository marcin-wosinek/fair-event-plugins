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
 * the URL-provided date (or, for legacy links, the numeric id). select()
 * reports the overview / session / unavailable state (event-info); resolve()
 * falls back to the default row for consumers without an unavailable state.
 *
 * This is the sanctioned single-event read path for display blocks/hooks
 * (event-info, OpenGraphHooks, AdminBarHooks) — it is not superseded by
 * FairEvents\Services\EventFeedProvider. It deliberately returns raw
 * EventDates rows rather than feed DTOs because those consumers need
 * venue_id/address/rrule/occurrence_type/id (not part of the DTO shape)
 * plus the `?event_date=` URL resolution above, which a DTO accessor
 * would not perform.
 */
class SelectedOccurrence {

	/**
	 * No session selected: the page's own event (a recurring series'
	 * overview, or an ordinary single event).
	 */
	const OVERVIEW = 'overview';

	/**
	 * A specific session of a recurring series: selected via `?event_date=`,
	 * or the session a page is linked to directly.
	 */
	const SESSION = 'session';

	/**
	 * `?event_date=` was present but malformed, or names no session of the
	 * page's event.
	 */
	const UNAVAILABLE = 'unavailable';

	/**
	 * Resolve the event-date row to display for a given post.
	 *
	 * Consumers that can't show an unavailable state get the page's default
	 * occurrence (see default_pivot()) for anything but a valid session.
	 *
	 * @param int                  $post_id Post ID to resolve the event for.
	 * @param EventDates|null|bool $default Optional pre-fetched default row.
	 *                                      `false` (the sentinel) means "fetch
	 *                                      it for me"; `null` is a legitimate
	 *                                      "no default exists" answer.
	 * @return EventDates|null
	 */
	public static function resolve( $post_id, $default = false ) {
		$selection = self::select( $post_id, $default );

		if ( ! $selection ) {
			return null;
		}

		if ( self::SESSION === $selection['state'] ) {
			return $selection['occurrence'];
		}

		return self::default_pivot( $selection['default'] );
	}

	/**
	 * Resolve what the current request selects on a post's event page.
	 *
	 * Unlike resolve(), this never substitutes another occurrence: an
	 * explicit selection that is malformed or outside the page's event is
	 * reported as unavailable, and a recurring page without a selection is
	 * reported as the overview (the series master), not today's/upcoming
	 * session.
	 *
	 * @param int                  $post_id Post ID to resolve the event for.
	 * @param EventDates|null|bool $default_row Optional pre-fetched default
	 *                                          row (same sentinel as resolve()).
	 * @return array{state: string, occurrence: EventDates|null, series: EventDates|null, default: EventDates}|null
	 *               `occurrence` is the row to display (null when unavailable),
	 *               `series` the recurring series' master (null for a single
	 *               event), `default` the post's own row. Null when the post
	 *               has no event date.
	 */
	public static function select( $post_id, $default_row = false ) {
		if ( false === $default_row ) {
			$default_row = EventDates::get_by_event_id( $post_id );
		}

		if ( ! $default_row ) {
			return null;
		}

		$series = self::series_master( $default_row );
		$param  = self::read_param();

		if ( null === $param ) {
			// A page linked directly to one session shows that session.
			if ( $series && 'generated' === $default_row->occurrence_type ) {
				return self::selection( self::SESSION, self::with_master_venue_fallback( $default_row, $series ), $series, $default_row );
			}

			return self::selection( self::OVERVIEW, $default_row, $series, $default_row );
		}

		$candidate = self::find_member( self::parse_param( $param ), $series ? $series : $default_row );

		if ( ! $candidate ) {
			return self::selection( self::UNAVAILABLE, null, $series, $default_row );
		}

		if ( ! $series ) {
			// A single event selecting its own date is just the event.
			return self::selection( self::OVERVIEW, $default_row, null, $default_row );
		}

		return self::selection( self::SESSION, self::with_master_venue_fallback( $candidate, $series ), $series, $default_row );
	}

	/**
	 * Classify a raw `event_date` param value.
	 *
	 * @param string $param Sanitized param value ('' when empty or malformed).
	 * @return array{type: string, value: string|int|null} `type` is 'date'
	 *               (value: `Y-m-d`), 'id' (value: legacy numeric id) or
	 *               'invalid' (value: null).
	 */
	public static function parse_param( string $param ): array {
		$date = OccurrenceDateParam::parse( $param );

		if ( null !== $date ) {
			return array(
				'type'  => 'date',
				'value' => $date,
			);
		}

		if ( OccurrenceDateParam::is_legacy_id( $param ) && absint( $param ) > 0 ) {
			return array(
				'type'  => 'id',
				'value' => absint( $param ),
			);
		}

		return array(
			'type'  => 'invalid',
			'value' => null,
		);
	}

	/**
	 * Read the raw `event_date` param from the request.
	 *
	 * @return string|null Null when absent; '' for an empty or non-string
	 *                     (e.g. array) value, which is a malformed selection.
	 */
	private static function read_param() {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- Public read-only view selection.
		if ( ! isset( $_GET['event_date'] ) ) {
			return null;
		}

		if ( ! is_string( $_GET['event_date'] ) ) {
			return '';
		}

		$param = sanitize_text_field( wp_unslash( $_GET['event_date'] ) );
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		return $param;
	}

	/**
	 * Find the selected session within the page's event.
	 *
	 * Only rows of the same event are accepted — the root itself or a
	 * generated child whose master_id points to it — so URL tampering can't
	 * render an unrelated event on this post's page.
	 *
	 * @param array      $request Parsed param (see parse_param()).
	 * @param EventDates $root    Series master, or the single event's row.
	 * @return EventDates|null Matching row, or null when none.
	 */
	private static function find_member( array $request, EventDates $root ) {
		if ( 'date' === $request['type'] ) {
			return EventDates::get_by_master_id_and_date( (int) $root->id, $request['value'] );
		}

		if ( 'id' !== $request['type'] ) {
			return null;
		}

		if ( $request['value'] === (int) $root->id ) {
			return $root;
		}

		$candidate = EventDates::get_by_id( $request['value'] );

		return ( $candidate && (int) $candidate->master_id === (int) $root->id ) ? $candidate : null;
	}

	/**
	 * The recurring series' master for a post's row.
	 *
	 * @param EventDates $default_row The post's row.
	 * @return EventDates|null The master row (the row itself when it is the
	 *                         master), or null for a single event.
	 */
	private static function series_master( EventDates $default_row ) {
		if ( 'master' === $default_row->occurrence_type ) {
			return $default_row;
		}

		if ( 'generated' === $default_row->occurrence_type && $default_row->master_id ) {
			return EventDates::get_by_id( $default_row->master_id );
		}

		return null;
	}

	/**
	 * Build a select() result.
	 *
	 * @param string          $state       One of the state constants.
	 * @param EventDates|null $occurrence  Row to display.
	 * @param EventDates|null $series      Series master.
	 * @param EventDates      $default_row The post's own row.
	 * @return array
	 */
	private static function selection( $state, $occurrence, $series, EventDates $default_row ) {
		return array(
			'state'      => $state,
			'occurrence' => $occurrence,
			'series'     => $series,
			'default'    => $default_row,
		);
	}

	/**
	 * Determine the page's default occurrence when no (valid) URL param is
	 * present: for recurring series, prefer today's occurrence if one
	 * exists, otherwise pivot to the closest upcoming occurrence (the
	 * master itself if its own date is still in the future, otherwise the
	 * next generated child) so all blocks on the page describe the
	 * relevant date instead of the abstract master row. Falls back to the
	 * master if no matching occurrences exist (e.g. series has fully
	 * ended), and returns non-recurring rows unchanged.
	 *
	 * @param EventDates $default The post's default (master or single) row.
	 * @return EventDates
	 */
	public static function default_pivot( EventDates $default ): EventDates {
		if ( 'master' !== $default->occurrence_type ) {
			return $default;
		}

		$today    = EventDates::get_by_master_id_and_date( (int) $default->id, current_time( 'Y-m-d' ) );
		$upcoming = $today ? array() : EventDates::get_upcoming_by_master_id( (int) $default->id );
		$pivot    = self::pick_default_pivot( $today, $upcoming );

		return $pivot ? self::with_master_venue_fallback( $pivot, $default ) : $default;
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
