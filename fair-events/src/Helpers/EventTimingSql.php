<?php
/**
 * SQL fragments for filtering and ordering event dates by canonical timing.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * Builds WHERE and ORDER BY fragments over the canonical timing columns
 * (`start_date`, `end_date`, `start_time`, `end_time`, `all_day`) of
 * `fair_event_dates`. See EventTiming for the contract.
 *
 * Every boundary is a naive site-local 'Y-m-d H:i:s' string, compared
 * as written: nothing converts timezones. A missing time is never
 * replaced by an event time; only these filtering boundaries apply:
 *
 *  - A date without a start time starts at the beginning of its start
 *    date for ordering and range checks.
 *  - A date without an end time (including all-day) stays current through
 *    its end date and is past from the following day.
 *
 * `$alias` is an internal table alias such as 'ed' (never user input).
 */
class EventTimingSql {

	/**
	 * The start key: start date and time, the beginning of the start
	 * date when there is no start time.
	 *
	 * @param string $alias Table alias.
	 * @return string SQL expression ('Y-m-d H:i:s').
	 */
	public static function start_key( $alias ) {
		return "CONCAT( {$alias}.start_date, ' ', COALESCE( {$alias}.start_time, '00:00:00' ) )";
	}

	/**
	 * The end key: end date and time, the last second of the end date when
	 * there is no end time.
	 *
	 * @param string $alias Table alias.
	 * @return string SQL expression ('Y-m-d H:i:s').
	 */
	public static function end_key( $alias ) {
		return "CONCAT( {$alias}.end_date, ' ', COALESCE( {$alias}.end_time, '23:59:59' ) )";
	}

	/**
	 * ORDER BY terms putting dates in start order: by start date, then
	 * start time with untimed dates first. Undated rows sort first
	 * ascending, last descending.
	 *
	 * @param string $alias     Table alias, or '' for the bare columns.
	 * @param string $direction 'ASC' or 'DESC'.
	 * @return string ORDER BY terms (without "ORDER BY").
	 */
	public static function order_by( $alias = '', $direction = 'ASC' ) {
		$prefix    = '' === $alias ? '' : $alias . '.';
		$direction = 'DESC' === strtoupper( $direction ) ? 'DESC' : 'ASC';

		return "{$prefix}start_date {$direction}, {$prefix}start_time {$direction}";
	}

	/**
	 * WHERE fragment: the date overlaps a range, inclusive at both edges.
	 *
	 * The date-only terms let the date indexes narrow the rows first.
	 *
	 * @param string $alias       Table alias.
	 * @param string $range_start Range start ('Y-m-d H:i:s').
	 * @param string $range_end   Range end ('Y-m-d H:i:s').
	 * @return array{0: string, 1: string[]} SQL with %s placeholders, and their values.
	 */
	public static function overlaps( $alias, $range_start, $range_end ) {
		$sql = "{$alias}.start_date <= %s AND {$alias}.end_date >= %s AND "
			. self::start_key( $alias ) . ' <= %s AND ' . self::end_key( $alias ) . ' >= %s';

		return array(
			$sql,
			array( substr( $range_end, 0, 10 ), substr( $range_start, 0, 10 ), $range_end, $range_start ),
		);
	}

	/**
	 * WHERE fragment: the date is upcoming at a moment.
	 *
	 * A fully timed or all-day date is upcoming until it starts. A timed
	 * date missing a start or end time stays upcoming until its end (see
	 * end_key()): with no end time, through its whole end date.
	 *
	 * @param string $alias  Table alias.
	 * @param string $moment Moment ('Y-m-d H:i:s').
	 * @return array{0: string, 1: string[]} SQL with %s placeholders, and their values.
	 */
	public static function upcoming( $alias, $moment ) {
		$sql = '( ' . self::start_key( $alias ) . ' >= %s'
			. " OR ( {$alias}.all_day = 0 AND ( {$alias}.start_time IS NULL OR {$alias}.end_time IS NULL ) AND " . self::end_key( $alias ) . ' >= %s ) )';

		return array( $sql, array( $moment, $moment ) );
	}

	/**
	 * WHERE fragment: the date has not ended at a moment, as
	 * SessionStatus::has_ended() decides it — so it is upcoming or ongoing.
	 *
	 * A date with an end time (and not all-day) ends exactly then. A date
	 * without one, and an all-day date, stays listed through its end date
	 * and is past from the following day.
	 *
	 * Compares naive site-local values, so during the hour repeated when
	 * daylight saving ends it can differ from SessionStatus by up to an hour.
	 *
	 * @param string $alias  Table alias.
	 * @param string $moment Moment ('Y-m-d H:i:s').
	 * @return array{0: string, 1: string[]} SQL with %s placeholders, and their values.
	 */
	public static function not_ended( $alias, $moment ) {
		$sql = "( ( {$alias}.all_day = 0 AND {$alias}.end_time IS NOT NULL AND CONCAT( {$alias}.end_date, ' ', {$alias}.end_time ) > %s )"
			. " OR ( ( {$alias}.all_day = 1 OR {$alias}.end_time IS NULL ) AND {$alias}.end_date >= %s ) )";

		return array( $sql, array( $moment, substr( $moment, 0, 10 ) ) );
	}

	/**
	 * The series-pass cutoff key, as EventTiming::series_pass_cutoff():
	 * the start time, the beginning of the day for all-day dates, and the
	 * end of the start date when there is no start time.
	 *
	 * @param string $alias Table alias.
	 * @return string SQL expression ('Y-m-d H:i:s').
	 */
	public static function pass_cutoff_key( $alias ) {
		return "CONCAT( {$alias}.start_date, ' ', CASE WHEN {$alias}.all_day = 1 THEN '00:00:00' ELSE COALESCE( {$alias}.start_time, '23:59:59' ) END )";
	}
}
