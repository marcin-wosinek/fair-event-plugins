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
 */
class QueryHelper {

	/**
	 * Join event dates table to query
	 *
	 * @param string    $join  JOIN clause.
	 * @param \WP_Query $query Query object.
	 * @return string Modified JOIN clause.
	 */
	public static function join_dates_table( $join, $query ) {
		global $wpdb;

		// Only modify if our custom query parameter is set
		if ( ! isset( $query->query_vars['fair_events_date_query'] ) ) {
			return $join;
		}

		$dates_table = $wpdb->prefix . 'fair_event_dates';
		$join       .= " LEFT JOIN {$dates_table} ON {$wpdb->posts}.ID = {$dates_table}.event_id AND {$dates_table}.instance_id IS NULL";

		return $join;
	}

	/**
	 * Filter posts by date criteria
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

		if ( isset( $date_query['start_after'] ) ) {
			$where .= $wpdb->prepare( " AND {$dates_table}.start_datetime >= %s", $date_query['start_after'] );
		}

		if ( isset( $date_query['end_before'] ) ) {
			$where .= $wpdb->prepare( " AND {$dates_table}.end_datetime < %s", $date_query['end_before'] );
		}

		if ( isset( $date_query['start_before'] ) ) {
			$where .= $wpdb->prepare( " AND {$dates_table}.start_datetime <= %s", $date_query['start_before'] );
		}

		if ( isset( $date_query['end_after'] ) ) {
			$where .= $wpdb->prepare( " AND {$dates_table}.end_datetime >= %s", $date_query['end_after'] );
		}

		return $where;
	}

	/**
	 * Order posts by date
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
		return "{$dates_table}.start_datetime {$order}";
	}
}
