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
	 * Cancelled/inactive rows are always excluded once the custom-table join
	 * is engaged, independent of which time filter (if any) is selected. A
	 * missing `end_datetime` is treated as equal to `start_datetime` (a
	 * single-instant event), so "past"/"ongoing" boundaries stay correct for
	 * events with no explicit end.
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

		if ( ! is_array( $date_query ) ) {
			return $where;
		}

		if ( isset( $date_query['start_after'] ) ) {
      // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$where .= $wpdb->prepare( " AND {$dates_table}.start_datetime >= %s", $date_query['start_after'] );
		}

		if ( isset( $date_query['end_before'] ) ) {
      // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$where .= $wpdb->prepare( " AND COALESCE( {$dates_table}.end_datetime, {$dates_table}.start_datetime ) < %s", $date_query['end_before'] );
		}

		if ( isset( $date_query['start_before'] ) ) {
      // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$where .= $wpdb->prepare( " AND {$dates_table}.start_datetime <= %s", $date_query['start_before'] );
		}

		if ( isset( $date_query['end_after'] ) ) {
      // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$where .= $wpdb->prepare( " AND COALESCE( {$dates_table}.end_datetime, {$dates_table}.start_datetime ) >= %s", $date_query['end_after'] );
		}

		return $where;
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

		return "{$aggregate}( {$dates_table}.start_datetime ) {$order}";
	}
}
