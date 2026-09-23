<?php
/**
 * Recurring-series grouping and date context for the Events List block.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * In the Events List block's Upcoming view, a local recurring series appears
 * once — at its next eligible occurrence, mixed chronologically with single
 * events — and its date reads as a schedule summary (see RecurrenceSummary).
 *
 * Grouping is list-specific: EventFeedProvider still returns individual
 * occurrences to calendars and every other consumer. Only local
 * (post-linked and standalone) series carry a `series_id`; iCal/API
 * occurrences have no dependable series identity and are never grouped —
 * in particular, never by title.
 *
 * The render context stack lets nested `fair-events/event-dates` blocks
 * describe the occurrence the list selected instead of resolving one on
 * their own (see SelectedOccurrence, which still governs single-event
 * pages).
 */
class EventsListSeries {

	const MODE_OCCURRENCE = 'occurrence';
	const MODE_QUERY_LOOP = 'query-loop';

	/**
	 * Active render contexts, innermost last.
	 *
	 * @var array[]
	 */
	private static $context_stack = array();

	/**
	 * Series metadata already loaded during this request, keyed by master
	 * event-date ID (null when the master no longer exists).
	 *
	 * @var array<int, array|null>
	 */
	private static $series_cache = array();

	/**
	 * Series identity for an event-date row: the master's ID for a master or
	 * generated row, null for a single (non-recurring) row.
	 *
	 * @param EventDates $row Event date row.
	 * @return int|null
	 */
	public static function series_id_for_row( EventDates $row ) {
		if ( 'master' === $row->occurrence_type ) {
			return (int) $row->id;
		}

		if ( 'generated' === $row->occurrence_type && $row->master_id ) {
			return (int) $row->master_id;
		}

		return null;
	}

	/**
	 * The Upcoming view's entries: occurrences starting at or after `$now`,
	 * with each local recurring series collapsed to its next one.
	 *
	 * EventFeedProvider's range is an overlap check, so for an open range
	 * starting at `$now` it also returns occurrences that started earlier and
	 * are still running — those belong to the Ongoing filter and are dropped
	 * here, before grouping, so a series is represented by its next start.
	 *
	 * @param array[]       $occurrences   Occurrence DTOs sorted by start ASC.
	 * @param string        $now           Naive site-local 'Y-m-d H:i:s' boundary (inclusive).
	 * @param callable|null $series_loader See group().
	 * @return array[] Grouped occurrence DTOs, sorted by start ASC.
	 */
	public static function upcoming( array $occurrences, $now, $series_loader = null ) {
		$starting = array_filter(
			$occurrences,
			function ( $occurrence ) use ( $now ) {
				return ( $occurrence['start'] ?? '' ) >= $now;
			}
		);

		return self::group( array_values( $starting ), $series_loader );
	}

	/**
	 * Keep one entry per local recurring series: its earliest occurrence in
	 * the (already eligibility-filtered, start-ascending) input. Single and
	 * external occurrences pass through unchanged, so series and single
	 * events stay mixed in chronological order. Each kept series entry gets
	 * a `series` key with its metadata; a series whose master can't be
	 * loaded is still collapsed to one entry but carries no metadata.
	 *
	 * @param array[]       $occurrences   Occurrence DTOs sorted by start ASC.
	 * @param callable|null $series_loader fn( int $series_id ): ?array —
	 *                                     defaults to load_series().
	 * @return array[] Grouped occurrence DTOs, still sorted by start ASC.
	 */
	public static function group( array $occurrences, $series_loader = null ) {
		if ( null === $series_loader ) {
			$series_loader = array( __CLASS__, 'load_series' );
		}

		$seen    = array();
		$grouped = array();

		foreach ( $occurrences as $occurrence ) {
			$series_id = $occurrence['series_id'] ?? null;

			if ( ! $series_id ) {
				$grouped[] = $occurrence;
				continue;
			}

			if ( isset( $seen[ $series_id ] ) ) {
				continue;
			}
			$seen[ $series_id ] = true;

			$series = call_user_func( $series_loader, (int) $series_id );
			if ( $series ) {
				$occurrence['series'] = $series;
			}

			$grouped[] = $occurrence;
		}

		return $grouped;
	}

	/**
	 * Load (and cache for the request) a series' metadata from its master.
	 *
	 * @param int $series_id Master event-date ID.
	 * @return array|null Series metadata (see RecurrenceSummary), or null.
	 */
	public static function load_series( $series_id ) {
		$series_id = (int) $series_id;

		if ( ! array_key_exists( $series_id, self::$series_cache ) ) {
			$master                           = EventDates::get_by_id( $series_id );
			self::$series_cache[ $series_id ] = $master ? self::series_from_master( $master ) : null;
		}

		return self::$series_cache[ $series_id ];
	}

	/**
	 * Build series metadata from a master row. The anchor pins the regular
	 * weekday/day-of-month to the master's originally-generated date, even if
	 * the master occurrence itself was later rescheduled.
	 *
	 * @param EventDates $master Master event-date row.
	 * @return array Series metadata (see RecurrenceSummary).
	 */
	public static function series_from_master( EventDates $master ) {
		$anchor_start = $master->start_datetime;
		if ( $master->recurrence_anchor && $master->start_datetime ) {
			$anchor_start = $master->recurrence_anchor . ' ' . DateHelper::local_time_full( $master->start_datetime );
		}

		return array(
			'id'              => (int) $master->id,
			'rrule'           => $master->rrule,
			'recurrence_mode' => $master->recurrence_mode,
			'anchor_start'    => $anchor_start,
			'all_day'         => (bool) $master->all_day,
		);
	}

	/**
	 * Date text for one list entry: the series summary for a grouped series
	 * entry, otherwise the occurrence's own date range.
	 *
	 * @param array $occurrence Occurrence DTO (optionally with `series`).
	 * @return string Plain (unescaped) text.
	 */
	public static function date_text( array $occurrence ) {
		if ( ! empty( $occurrence['series'] ) ) {
			return RecurrenceSummary::format( $occurrence['series'], $occurrence );
		}

		return DateRangeFormatter::format(
			$occurrence['start'] ?? '',
			$occurrence['end'] ?? '',
			! empty( $occurrence['all_day'] )
		);
	}

	/**
	 * Date text for a post rendered by an Upcoming Query Loop layout: its
	 * earliest active occurrence starting at or after `$now` — the same row
	 * QueryHelper's MIN(start) ordering sorted it by — summarized as a series
	 * when that row belongs to one.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $now     Naive site-local 'Y-m-d H:i:s' boundary.
	 * @return string|null Plain text, or null when the post has no upcoming occurrence.
	 */
	public static function upcoming_date_text_for_post( $post_id, $now ) {
		$row = self::get_next_row_for_post( $post_id, $now );

		if ( ! $row ) {
			return null;
		}

		$occurrence = array(
			'start'   => $row->start_datetime,
			'end'     => $row->end_datetime,
			'all_day' => (bool) $row->all_day,
		);

		$series_id = self::series_id_for_row( $row );
		if ( $series_id ) {
			$series = self::load_series( $series_id );
			if ( $series ) {
				$occurrence['series'] = $series;
			}
		}

		return self::date_text( $occurrence );
	}

	/**
	 * Earliest active row starting at or after `$now` that QueryHelper's join
	 * matches to this post: rows linked directly, plus generated rows whose
	 * master is linked to it.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $now     Naive site-local 'Y-m-d H:i:s' boundary.
	 * @return EventDates|null
	 */
	private static function get_next_row_for_post( $post_id, $now ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- per-render lookup on the plugin's own table, same as EventDates.
		$row_id = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT ed.id FROM %i ed
				WHERE ed.status = 'active' AND ed.start_datetime >= %s
				AND ( ed.event_id = %d OR ( ed.event_id IS NULL AND ed.master_id IN ( SELECT m.id FROM %i m WHERE m.event_id = %d ) ) )
				ORDER BY ed.start_datetime ASC, ed.id ASC
				LIMIT 1",
				$table_name,
				$now,
				$post_id,
				$table_name,
				$post_id
			)
		);

		return $row_id ? EventDates::get_by_id( (int) $row_id ) : null;
	}

	/**
	 * Enter a render context for nested blocks.
	 *
	 * @param array $context `mode` (MODE_OCCURRENCE or MODE_QUERY_LOOP),
	 *                       `time_filter`, and either `occurrence` (the DTO
	 *                       being rendered) or `now` (the list's boundary).
	 * @return void
	 */
	public static function push_context( array $context ) {
		self::$context_stack[] = $context;
	}

	/**
	 * Leave the innermost render context.
	 *
	 * @return void
	 */
	public static function pop_context() {
		array_pop( self::$context_stack );
	}

	/**
	 * The innermost active render context, or null outside an Events List.
	 *
	 * @return array|null
	 */
	public static function current_context() {
		return empty( self::$context_stack ) ? null : end( self::$context_stack );
	}

	/**
	 * Date text the Events List wants a nested event-dates block to show for
	 * a post, or null to let the block resolve its own occurrence.
	 *
	 * @param int $post_id Post ID the event-dates block is rendering for (0 when none).
	 * @return string|null Plain text, or null.
	 */
	public static function date_text_for_nested_block( $post_id ) {
		$context = self::current_context();

		// Past, Ongoing, and All keep each block's own occurrence resolution.
		if ( ! $context || 'upcoming' !== ( $context['time_filter'] ?? '' ) ) {
			return null;
		}

		if ( self::MODE_OCCURRENCE === $context['mode'] ) {
			$occurrence = $context['occurrence'];

			// Only describe the occurrence the list is rendering; an
			// event-dates block pointed at some other post falls through.
			if ( 'post' === ( $occurrence['source'] ?? '' ) && (int) ( $occurrence['event_id'] ?? 0 ) !== (int) $post_id ) {
				return null;
			}

			return self::date_text( $occurrence );
		}

		if ( self::MODE_QUERY_LOOP === $context['mode'] && $post_id ) {
			return self::upcoming_date_text_for_post( $post_id, $context['now'] );
		}

		return null;
	}
}
