<?php
/**
 * Date Range Formatter for human-friendly event date ranges.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * Formats event start/end datetimes as compact, localized date ranges
 * such as "26–28 June", "31 October—2 November", or
 * "19:30—21:30, 15 October".
 */
class DateRangeFormatter {

	/**
	 * Format an event date range.
	 *
	 * @param string $start_datetime Naive 'Y-m-d H:i:s' start datetime in site-local time.
	 * @param string $end_datetime   Naive 'Y-m-d H:i:s' end datetime in site-local time, or empty.
	 * @param bool   $all_day        Whether the event is all-day.
	 * @param bool   $always_show_year Whether to show the year even when it is
	 *                                 the current year (e.g. for a selected
	 *                                 session, which may be in any year).
	 * @return string Formatted date range, or empty string if no start datetime.
	 */
	public static function format( $start_datetime, $end_datetime, $all_day, $always_show_year = false ) {
		if ( empty( $start_datetime ) ) {
			return '';
		}

		$start_timestamp = DateHelper::local_to_timestamp( $start_datetime );
		if ( false === $start_timestamp ) {
			return $start_datetime;
		}

		$end_timestamp = $end_datetime ? DateHelper::local_to_timestamp( $end_datetime ) : null;

		if ( $all_day ) {
			return self::format_all_day( $start_timestamp, $end_timestamp, $always_show_year );
		}

		return self::format_timed( $start_timestamp, $end_timestamp, $always_show_year );
	}

	/**
	 * Format an event date range from its canonical timing (see EventTiming).
	 *
	 * Only supplied times are shown: a date without times reads like an
	 * all-day range, and a start time without an end time precedes the
	 * dates. Nothing substitutes a missing time.
	 *
	 * @param array $timing           Canonical timing.
	 * @param bool  $always_show_year Whether to show the current year too.
	 * @return string Formatted date range, or empty string for an undated timing.
	 */
	public static function format_timing( array $timing, $always_show_year = false ) {
		$timing = array_merge( EventTiming::undated(), $timing );
		if ( empty( $timing['start_date'] ) ) {
			return '';
		}

		$end_date   = $timing['end_date'] ?? $timing['start_date'];
		$start_time = $timing['all_day'] ? null : $timing['start_time'];
		$end_time   = $timing['all_day'] ? null : $timing['end_time'];

		$start_timestamp = DateHelper::local_to_timestamp( $timing['start_date'] . ' ' . ( $start_time ?? '00:00:00' ) );
		if ( false === $start_timestamp ) {
			return $timing['start_date'];
		}

		if ( null !== $start_time && null !== $end_time ) {
			$end_timestamp = DateHelper::local_to_timestamp( $end_date . ' ' . $end_time );
			return self::format_timed( $start_timestamp, $end_timestamp ? $end_timestamp : null, $always_show_year );
		}

		$end_timestamp = $end_date !== $timing['start_date'] ? DateHelper::local_to_timestamp( $end_date . ' 00:00:00' ) : null;
		$dates         = self::format_all_day( $start_timestamp, $end_timestamp ? $end_timestamp : null, $always_show_year );

		return null !== $start_time ? wp_date( 'H:i', $start_timestamp ) . ', ' . $dates : $dates;
	}

	/**
	 * Format an all-day event date range.
	 *
	 * @param int      $start_timestamp Start Unix timestamp.
	 * @param int|null $end_timestamp   End Unix timestamp, or null.
	 * @param bool     $always_show_year Whether to show the current year too.
	 * @return string Formatted date range.
	 */
	private static function format_all_day( $start_timestamp, $end_timestamp, $always_show_year ) {
		$start_day   = wp_date( 'j', $start_timestamp );
		$start_month = wp_date( 'F', $start_timestamp );
		$start_year  = wp_date( 'Y', $start_timestamp );
		// No year ever equals '', so every year comparison below adds the year.
		$current_year = $always_show_year ? '' : wp_date( 'Y' );

		if ( ! $end_timestamp ) {
			$single = $start_day . ' ' . $start_month;
			if ( $start_year !== $current_year ) {
				$single .= ' ' . $start_year;
			}
			return $single;
		}

		$end_day   = wp_date( 'j', $end_timestamp );
		$end_month = wp_date( 'F', $end_timestamp );
		$end_year  = wp_date( 'Y', $end_timestamp );

		// Same month and year.
		if ( $start_month === $end_month && $start_year === $end_year ) {
			if ( $start_day === $end_day ) {
				// Single day: "15 October" or "15 October 2027".
				$single = $start_day . ' ' . $start_month;
				if ( $start_year !== $current_year ) {
					$single .= ' ' . $start_year;
				}
				return $single;
			}
			// Same month: "26–28 June" or "26–28 June 2027".
			$range = $start_day . '–' . $end_day . ' ' . $start_month;
			if ( $start_year !== $current_year ) {
				$range .= ' ' . $start_year;
			}
			return $range;
		}

		// Different months, same year: "31 October—2 November" or with year suffix.
		if ( $start_year === $end_year ) {
			$range = $start_day . ' ' . $start_month . '—' . $end_day . ' ' . $end_month;
			if ( $start_year !== $current_year ) {
				$range .= ' ' . $start_year;
			}
			return $range;
		}

		// Different years: "31 December 2024—2 January 2025".
		return $start_day . ' ' . $start_month . ' ' . $start_year . '—' . $end_day . ' ' . $end_month . ' ' . $end_year;
	}

	/**
	 * Format a timed event date range.
	 *
	 * @param int      $start_timestamp Start Unix timestamp.
	 * @param int|null $end_timestamp   End Unix timestamp, or null.
	 * @param bool     $always_show_year Whether to show the current year too.
	 * @return string Formatted date range.
	 */
	private static function format_timed( $start_timestamp, $end_timestamp, $always_show_year ) {
		$start_time  = wp_date( 'H:i', $start_timestamp );
		$start_day   = wp_date( 'j', $start_timestamp );
		$start_month = wp_date( 'F', $start_timestamp );
		$start_year  = wp_date( 'Y', $start_timestamp );
		// No year ever equals '', so every year comparison below adds the year.
		$current_year = $always_show_year ? '' : wp_date( 'Y' );

		if ( ! $end_timestamp ) {
			$start_date_str = $start_day . ' ' . $start_month;
			if ( $start_year !== $current_year ) {
				$start_date_str .= ' ' . $start_year;
			}
			return $start_time . ', ' . $start_date_str;
		}

		$end_time  = wp_date( 'H:i', $end_timestamp );
		$end_day   = wp_date( 'j', $end_timestamp );
		$end_month = wp_date( 'F', $end_timestamp );
		$end_year  = wp_date( 'Y', $end_timestamp );

		$start_date_str = $start_day . ' ' . $start_month;
		$end_date_str   = $end_day . ' ' . $end_month;

		if ( $start_year !== $current_year ) {
			$start_date_str .= ' ' . $start_year;
		}
		if ( $end_year !== $current_year ) {
			$end_date_str .= ' ' . $end_year;
		}

		// Same day: "19:30—21:30, 15 October".
		if ( wp_date( 'Y-m-d', $start_timestamp ) === wp_date( 'Y-m-d', $end_timestamp ) ) {
			return $start_time . '—' . $end_time . ', ' . $start_date_str;
		}

		// Different days: "22:00 15 November—03:00 16 November".
		return $start_time . ' ' . $start_date_str . '—' . $end_time . ' ' . $end_date_str;
	}
}
