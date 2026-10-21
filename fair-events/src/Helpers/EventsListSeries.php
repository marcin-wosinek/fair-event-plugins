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
	 * Next upcoming rows already loaded during this request, keyed by the
	 * list's boundary and then by post ID (null when the post has none).
	 *
	 * @var array<string, array<int, EventDates|null>>
	 */
	private static $next_row_cache = array();

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
	 * The Upcoming view's entries: upcoming occurrences (see
	 * SessionStatus::is_upcoming(): starting at or after `$now`, or missing a
	 * time and not yet ended), with each local recurring series collapsed to
	 * its next one.
	 *
	 * EventFeedProvider's range is an overlap check, so for an open range
	 * starting at `$now` it also returns fully timed occurrences that started
	 * earlier and are still running — those belong to the Ongoing filter and
	 * are dropped here, before grouping, so a series is represented by its
	 * next start.
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
				if ( isset( $occurrence['timing'] ) && is_array( $occurrence['timing'] ) ) {
					return SessionStatus::is_upcoming( $occurrence['timing'], $now );
				}

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
		$timing       = $master->get_timing();
		$anchor_start = EventTiming::range_keys(
			$master->recurrence_anchor && $timing['start_date'] ? EventTiming::for_date( $timing, $master->recurrence_anchor ) : $timing
		)['start'];

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

		if ( isset( $occurrence['timing'] ) && is_array( $occurrence['timing'] ) ) {
			return DateRangeFormatter::format_timing( $occurrence['timing'] );
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

		$range      = EventTiming::range_keys( $row->get_timing() );
		$occurrence = array(
			'start'   => $range['start'],
			'end'     => $range['end'],
			'all_day' => (bool) $row->all_day,
			'timing'  => $row->get_timing(),
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
	 * Earliest upcoming active row (see EventTimingSql::upcoming()) that
	 * QueryHelper's join matches to this post: rows linked directly, plus
	 * generated rows whose master is linked to it.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $now     Naive site-local 'Y-m-d H:i:s' boundary.
	 * @return EventDates|null
	 */
	private static function get_next_row_for_post( $post_id, $now ) {
		global $wpdb;

		if ( isset( self::$next_row_cache[ $now ] ) && array_key_exists( (int) $post_id, self::$next_row_cache[ $now ] ) ) {
			return self::$next_row_cache[ $now ][ (int) $post_id ];
		}

		$table_name = $wpdb->prefix . 'fair_event_dates';

		list( $upcoming_sql, $upcoming_args ) = EventTimingSql::upcoming( 'ed', $now );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $upcoming_sql is a static internal template; its values are passed in the one array.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- per-render lookup on the plugin's own table, same as EventDates.
		$row_id = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT ed.id FROM %i ed
				WHERE ed.status = 'active' AND {$upcoming_sql}
				AND ( ed.event_id = %d OR ( ed.event_id IS NULL AND ed.master_id IN ( SELECT m.id FROM %i m WHERE m.event_id = %d ) ) )
				ORDER BY ed.start_date ASC, ed.start_time ASC, ed.id ASC
				LIMIT 1",
				array_merge( array( $table_name ), $upcoming_args, array( $post_id, $table_name, $post_id ) )
			)
		);
		// phpcs:enable

		return $row_id ? EventDates::get_by_id( (int) $row_id ) : null;
	}

	/**
	 * Load the next upcoming row (see get_next_row_for_post()) of many posts
	 * at once, so a Query Loop layout doesn't look each one up on its own:
	 * two queries in all instead of two per rendered post.
	 *
	 * @param int[]  $post_ids Post IDs.
	 * @param string $now      Naive site-local 'Y-m-d H:i:s' boundary.
	 * @return void
	 */
	public static function preload_next_rows( array $post_ids, $now ) {
		global $wpdb;

		$cached   = self::$next_row_cache[ $now ] ?? array();
		$post_ids = array_values(
			array_filter(
				array_unique( array_map( 'intval', $post_ids ) ),
				function ( $post_id ) use ( $cached ) {
					return $post_id > 0 && ! array_key_exists( $post_id, $cached );
				}
			)
		);

		if ( empty( $post_ids ) ) {
			return;
		}

		$table_name   = $wpdb->prefix . 'fair_event_dates';
		$placeholders = implode( ', ', array_fill( 0, count( $post_ids ), '%d' ) );

		list( $upcoming_sql, $upcoming_args ) = EventTimingSql::upcoming( 'ed', $now );

		// The same rows and order as get_next_row_for_post(), for every post
		// at once: a generated row with no event_id of its own belongs to
		// its master's post.
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- $upcoming_sql is a static internal template and $placeholders a list of %d; their values are passed in the one array.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- per-render lookup on the plugin's own table, same as EventDates.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT ed.id, COALESCE( ed.event_id, m.event_id ) AS post_id FROM %i ed
				LEFT JOIN %i m ON ed.event_id IS NULL AND m.id = ed.master_id
				WHERE ed.status = 'active' AND {$upcoming_sql}
				AND ( ed.event_id IN ( {$placeholders} ) OR ( ed.event_id IS NULL AND m.event_id IN ( {$placeholders} ) ) )
				ORDER BY ed.start_date ASC, ed.start_time ASC, ed.id ASC",
				array_merge( array( $table_name, $table_name ), $upcoming_args, $post_ids, $post_ids )
			)
		);
		// phpcs:enable

		$next_ids = array();
		foreach ( (array) $rows as $row ) {
			$row_post_id = (int) $row->post_id;
			if ( ! isset( $next_ids[ $row_post_id ] ) ) {
				$next_ids[ $row_post_id ] = (int) $row->id;
			}
		}

		$dates = EventDates::get_by_ids( array_values( $next_ids ) );

		foreach ( $post_ids as $post_id ) {
			self::$next_row_cache[ $now ][ $post_id ] = isset( $next_ids[ $post_id ] ) ? ( $dates[ $next_ids[ $post_id ] ] ?? null ) : null;
		}
	}

	/**
	 * `the_posts` callback for an Upcoming Query Loop layout: preload the
	 * next rows of the posts a Query Loop inside the list is about to
	 * render. Other queries, and lists in other modes, pass through.
	 *
	 * @param \WP_Post[] $posts Queried posts.
	 * @param \WP_Query  $query The query.
	 * @return \WP_Post[] Unchanged posts.
	 */
	public static function preload_for_query( $posts, $query ) {
		$context = self::current_context();

		if (
			is_array( $posts ) && $posts
			&& $context && self::MODE_QUERY_LOOP === $context['mode'] && 'upcoming' === ( $context['time_filter'] ?? '' )
			&& $query instanceof \WP_Query && $query->get( 'fair_events_date_query' )
		) {
			self::preload_next_rows(
				array_map(
					function ( $post ) {
						return is_object( $post ) ? (int) $post->ID : (int) $post;
					},
					$posts
				),
				$context['now']
			);
		}

		return $posts;
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
