<?php
/**
 * Query helper for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * Helper class for custom table queries
 *
 * These `posts_join`/`posts_where`/`posts_orderby`/`posts_groupby` filters
 * are the one sanctioned non-provider read path: Query Loop patterns
 * (events-list block) drive a real WP_Query, which cannot consume the DTOs
 * that FairEvents\Services\EventFeedProvider produces, so this joins the
 * fair_event_dates table directly into the post query instead.
 *
 * All four filters key off the same `fair_events_date_query` query var, so a
 * caller enables/disables the whole custom-table behavior in one place (see
 * events-list's render.php).
 */
class QueryHelper {

	/**
	 * Join event dates table to query
	 *
	 * A row matches a post either directly (`event_id` points at it) or, for
	 * a generated recurring occurrence that doesn't carry its own `event_id`,
	 * through its master row's `event_id` — otherwise generated occurrences
	 * of a post-linked recurring series never resolve their post at all.
	 *
	 * @param string    $join  JOIN clause.
	 * @param \WP_Query $query Query object.
	 * @return string Modified JOIN clause.
	 */
	public static function join_dates_table( $join, $query ) {
		global $wpdb;

		// Only modify if our custom query parameter is set.
		if ( ! isset( $query->query_vars['fair_events_date_query'] ) ) {
			return $join;
		}

		$dates_table = $wpdb->prefix . 'fair_event_dates';
		$join       .= " LEFT JOIN {$dates_table} ON ( {$wpdb->posts}.ID = {$dates_table}.event_id" .
			" OR ( {$dates_table}.event_id IS NULL AND {$dates_table}.master_id IS NOT NULL" .
			" AND {$wpdb->posts}.ID = ( SELECT fair_ed_master.event_id FROM {$dates_table} AS fair_ed_master WHERE fair_ed_master.id = {$dates_table}.master_id ) ) )";

		return $join;
	}

	/**
	 * Filter posts by date criteria
	 *
	 * Cancelled/inactive rows and events drafted in Fair Events are always
	 * excluded once the custom-table join is engaged, independent of which
	 * time filter (if any) is selected. A drafted event stays out even when
	 * the query itself asks for draft posts; a generated occurrence follows
	 * its master's publication status, a single or master row its own.
	 *
	 * Boundaries follow EventTimingSql: `start_after` keeps upcoming dates
	 * (a date missing a time stays upcoming until its end), and a date
	 * without an end time ends with its end date, so it stays "ongoing"
	 * through that day and is "past" from the next.
	 *
	 * `any` holds a list of such criteria sets, ORed together (the
	 * events-list block's combined time periods); the GROUP BY in
	 * group_by_post() keeps a post matching several sets from repeating.
	 *
	 * @param string    $where WHERE clause.
	 * @param \WP_Query $query Query object.
	 * @return string Modified WHERE clause.
	 */
	public static function filter_by_dates( $where, $query ) {
		global $wpdb;

		$date_query = $query->get( 'fair_events_date_query' );
		if ( ! $date_query ) {
			return $where;
		}

		$dates_table = $wpdb->prefix . 'fair_event_dates';

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$where .= " AND {$dates_table}.status = 'active'";

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$where .= " AND COALESCE( ( SELECT fair_ed_publication.publication_status FROM {$dates_table} AS fair_ed_publication WHERE fair_ed_publication.id = COALESCE( {$dates_table}.master_id, {$dates_table}.id ) ), 'publish' ) = 'publish'";

		if ( ! is_array( $date_query ) ) {
			return $where;
		}

		if ( isset( $date_query['any'] ) && is_array( $date_query['any'] ) ) {
			$groups = array();
			foreach ( $date_query['any'] as $group ) {
				$conditions = is_array( $group ) ? self::date_conditions( $dates_table, $group ) : array();
				if ( empty( $conditions ) ) {
					// A group without conditions matches every date row, so
					// the whole OR does too.
					return $where;
				}
				$groups[] = '( ' . implode( ' AND ', $conditions ) . ' )';
			}

			if ( ! empty( $groups ) ) {
				$where .= ' AND ( ' . implode( ' OR ', $groups ) . ' )';
			}

			return $where;
		}

		foreach ( self::date_conditions( $dates_table, $date_query ) as $condition ) {
			$where .= ' AND ' . $condition;
		}

		return $where;
	}

	/**
	 * Prepared SQL conditions for one set of date criteria, to be joined
	 * with AND.
	 *
	 * @param string $dates_table Dates table name.
	 * @param array  $criteria    Any of `start_after`, `end_before`,
	 *                            `start_before`, `end_after` (site-local
	 *                            'Y-m-d H:i:s').
	 * @return string[] Prepared conditions.
	 */
	private static function date_conditions( $dates_table, array $criteria ) {
		global $wpdb;

		$start_key  = EventTimingSql::start_key( $dates_table );
		$end_key    = EventTimingSql::end_key( $dates_table );
		$conditions = array();

		if ( isset( $criteria['start_after'] ) ) {
			list( $upcoming_sql, $upcoming_args ) = EventTimingSql::upcoming( $dates_table, $criteria['start_after'] );
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- $upcoming_sql is a static internal template holding the placeholders.
			$conditions[] = $wpdb->prepare( $upcoming_sql, $upcoming_args );
		}

		if ( isset( $criteria['end_before'] ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$conditions[] = $wpdb->prepare( "{$end_key} < %s", $criteria['end_before'] );
		}

		if ( isset( $criteria['start_before'] ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$conditions[] = $wpdb->prepare( "{$start_key} <= %s", $criteria['start_before'] );
		}

		if ( isset( $criteria['end_after'] ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$conditions[] = $wpdb->prepare( "{$end_key} >= %s", $criteria['end_after'] );
		}

		return $conditions;
	}

	/**
	 * Group posts by ID once the custom-table join is engaged.
	 *
	 * The join in join_dates_table() can match a post through more than one
	 * date row (an event with several occurrences in range), which would
	 * otherwise duplicate that post in the results. order_by_dates()
	 * aggregates its ORDER BY expression to stay compatible with this GROUP
	 * BY under `ONLY_FULL_GROUP_BY`.
	 *
	 * @param string    $groupby GROUP BY clause.
	 * @param \WP_Query $query   Query object.
	 * @return string Modified GROUP BY clause.
	 */
	public static function group_by_post( $groupby, $query ) {
		global $wpdb;

		if ( ! isset( $query->query_vars['fair_events_date_query'] ) ) {
			return $groupby;
		}

		return "{$wpdb->posts}.ID";
	}

	/**
	 * Order posts by date
	 *
	 * Aggregated (MIN for ascending, MAX for descending) so the expression
	 * stays valid alongside group_by_post()'s `GROUP BY {posts}.ID` under
	 * `ONLY_FULL_GROUP_BY` — it picks each post's soonest occurrence for an
	 * ascending (upcoming) order and its most recent one for a descending
	 * (past) order.
	 *
	 * @param string    $orderby ORDERBY clause.
	 * @param \WP_Query $query   Query object.
	 * @return string Modified ORDERBY clause.
	 */
	public static function order_by_dates( $orderby, $query ) {
		global $wpdb;

		$order = $query->get( 'fair_events_order' );
		if ( ! $order ) {
			return $orderby;
		}

		$dates_table = $wpdb->prefix . 'fair_event_dates';
		$aggregate   = ( 'DESC' === strtoupper( $order ) ) ? 'MAX' : 'MIN';

		return "{$aggregate}( " . EventTimingSql::start_key( $dates_table ) . " ) {$order}";
	}
}
