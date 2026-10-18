<?php
/**
 * Which date of a series a single calendar export (a link or a download)
 * carries.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * Series rules for one "Add to calendar" export, following the calendar
 * export policy of #1819: only exportable dates
 * (EventTiming::is_calendar_exportable()) are exported, and a recurrence
 * rule is only exported when it cannot bring back a date that is not
 * exportable. A series that mixes both is exported one date at a time:
 * the next exportable date that has not ended.
 *
 * Works on canonical timings, so it needs no database.
 */
class CalendarExport {

	/**
	 * Whether every date of a series is exportable, so its recurrence rule
	 * can be exported.
	 *
	 * @param array[] $timings Canonical timings of the series' active dates.
	 * @return bool True when all are exportable.
	 */
	public static function all_exportable( array $timings ) {
		foreach ( $timings as $timing ) {
			if ( ! EventTiming::is_calendar_exportable( $timing ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * The earliest exportable date that has not ended yet.
	 *
	 * @param array[] $timings Canonical timings of the series' active dates.
	 * @param string  $now     Current site-local time ('Y-m-d H:i:s').
	 * @return int|string|null Key of that date in `$timings`, or null when
	 *                         there is none.
	 */
	public static function next_exportable( array $timings, $now ) {
		$next = null;

		foreach ( $timings as $key => $timing ) {
			if ( ! EventTiming::is_calendar_exportable( $timing ) || self::local_end( $timing ) < $now ) {
				continue;
			}

			if ( null === $next || self::local_start( $timing ) < self::local_start( $timings[ $next ] ) ) {
				$next = $key;
			}
		}

		return $next;
	}

	/**
	 * Site-local start of an exportable timing: its start time, or the
	 * start of its first day when all-day.
	 *
	 * @param array $timing Exportable canonical timing.
	 * @return string 'Y-m-d H:i:s'.
	 */
	private static function local_start( array $timing ) {
		return $timing['start_date'] . ' ' . ( $timing['all_day'] ? '00:00:00' : $timing['start_time'] );
	}

	/**
	 * Site-local end of an exportable timing: its end time, or the end of
	 * its last day when all-day.
	 *
	 * @param array $timing Exportable canonical timing.
	 * @return string 'Y-m-d H:i:s'.
	 */
	private static function local_end( array $timing ) {
		return ( $timing['end_date'] ?? $timing['start_date'] ) . ' ' . ( $timing['all_day'] ? '23:59:59' : $timing['end_time'] );
	}
}
