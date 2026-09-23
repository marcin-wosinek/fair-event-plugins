<?php
/**
 * Human-readable summaries of a recurring series' schedule.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

use FairEvents\Services\RecurrenceService;

defined( 'WPINC' ) || die;

/**
 * Formats a recurring series as one line of text, such as
 * "Weekly on Mondays at 18:00; next occurrence: 28 September".
 *
 * The regular schedule comes from the series rule and its anchor (the
 * master's originally-generated date and start time), never from the
 * occurrence being shown — a single rescheduled occurrence must not change
 * the advertised weekday or time. The "next occurrence" part comes from the
 * actual selected occurrence, so cancellations and rescheduling show through.
 *
 * `$series` shape: rrule (string|null), recurrence_mode ('rule'|'manual'|…),
 * anchor_start (naive site-local 'Y-m-d H:i:s'), all_day (bool).
 */
class RecurrenceSummary {

	/**
	 * Full summary: the regular schedule plus the next occurrence, or a
	 * generic "Recurring event" line when the schedule can't be described.
	 *
	 * @param array $series     Series metadata (see class docblock).
	 * @param array $occurrence Selected occurrence: start, end, all_day.
	 * @return string Plain (unescaped) text.
	 */
	public static function format( array $series, array $occurrence ) {
		$schedule = self::format_schedule( $series );
		$next     = self::format_next( $series, $occurrence );

		if ( '' === $schedule ) {
			/* translators: %s: date (and time) of the next occurrence, e.g. "28 September". */
			return sprintf( __( 'Recurring event; next occurrence: %s', 'fair-events' ), $next );
		}

		/* translators: 1: regular schedule, e.g. "Weekly on Mondays at 18:00". 2: date (and time) of the next occurrence, e.g. "28 September". */
		return sprintf( __( '%1$s; next occurrence: %2$s', 'fair-events' ), $schedule, $next );
	}

	/**
	 * Describe the regular schedule, e.g. "Weekly on Mondays at 18:00".
	 *
	 * Supports DAILY, WEEKLY, and MONTHLY rules with any interval. Returns ''
	 * for manually selected dates and any rule it can't describe faithfully
	 * (e.g. YEARLY), so callers fall back to a generic line instead of
	 * inventing a frequency.
	 *
	 * @param array $series Series metadata (see class docblock).
	 * @return string Plain text, or ''.
	 */
	public static function format_schedule( array $series ) {
		if ( 'manual' === ( $series['recurrence_mode'] ?? '' ) || empty( $series['rrule'] ) || empty( $series['anchor_start'] ) ) {
			return '';
		}

		$anchor = DateHelper::local_to_datetime( $series['anchor_start'] );
		if ( false === $anchor ) {
			return '';
		}

		$parsed   = RecurrenceService::parse_rrule( $series['rrule'] );
		$interval = (int) $parsed['interval'];
		$all_day  = ! empty( $series['all_day'] );
		$time     = $anchor->format( 'H:i' );

		switch ( $parsed['freq'] ) {
			case 'DAILY':
				return self::format_daily( $interval, $all_day, $time );
			case 'WEEKLY':
				return self::format_weekly( $interval, $all_day, $time, self::weekday_plural( (int) $anchor->format( 'N' ) ) );
			case 'MONTHLY':
				return self::format_monthly( $interval, $all_day, $time, (int) $anchor->format( 'j' ) );
			default:
				return '';
		}
	}

	/**
	 * Describe the selected occurrence's date. When it starts at the regular
	 * time on a single day, the time is already in the schedule and only the
	 * date is shown; otherwise (rescheduled, multi-day, or no describable
	 * schedule) the full date range is shown.
	 *
	 * @param array $series     Series metadata (see class docblock).
	 * @param array $occurrence Selected occurrence: start, end, all_day.
	 * @return string Plain text.
	 */
	public static function format_next( array $series, array $occurrence ) {
		$start   = $occurrence['start'] ?? '';
		$end     = $occurrence['end'] ?? '';
		$all_day = ! empty( $occurrence['all_day'] );

		$single_day      = '' === (string) $end || DateHelper::local_date( $end ) === DateHelper::local_date( $start );
		$at_regular_time = $all_day
			|| ( ! empty( $series['anchor_start'] ) && DateHelper::local_time( $series['anchor_start'] ) === DateHelper::local_time( $start ) );

		if ( $single_day && $at_regular_time && '' !== self::format_schedule( $series ) ) {
			return DateRangeFormatter::format( $start, '', true );
		}

		return DateRangeFormatter::format( $start, $end, $all_day );
	}

	/**
	 * Daily schedule text.
	 *
	 * @param int    $interval Rule interval.
	 * @param bool   $all_day  Whether the series is all-day.
	 * @param string $time     Regular start time, 'H:i'.
	 * @return string
	 */
	private static function format_daily( $interval, $all_day, $time ) {
		if ( 1 === $interval ) {
			if ( $all_day ) {
				return __( 'Daily', 'fair-events' );
			}
			/* translators: %s: start time, e.g. "18:00". */
			return sprintf( __( 'Daily at %s', 'fair-events' ), $time );
		}

		if ( $all_day ) {
			/* translators: %d: number of days between occurrences (2 or more). */
			return sprintf( _n( 'Every %d day', 'Every %d days', $interval, 'fair-events' ), $interval );
		}

		/* translators: 1: number of days between occurrences (2 or more). 2: start time, e.g. "18:00". */
		return sprintf( _n( 'Every %1$d day at %2$s', 'Every %1$d days at %2$s', $interval, 'fair-events' ), $interval, $time );
	}

	/**
	 * Weekly schedule text.
	 *
	 * @param int    $interval Rule interval.
	 * @param bool   $all_day  Whether the series is all-day.
	 * @param string $time     Regular start time, 'H:i'.
	 * @param string $weekday  Plural weekday name, e.g. "Mondays".
	 * @return string
	 */
	private static function format_weekly( $interval, $all_day, $time, $weekday ) {
		if ( 1 === $interval ) {
			if ( $all_day ) {
				/* translators: %s: plural weekday name, e.g. "Mondays". */
				return sprintf( __( 'Weekly on %s', 'fair-events' ), $weekday );
			}
			/* translators: 1: plural weekday name, e.g. "Mondays". 2: start time, e.g. "18:00". */
			return sprintf( __( 'Weekly on %1$s at %2$s', 'fair-events' ), $weekday, $time );
		}

		if ( $all_day ) {
			/* translators: 1: number of weeks between occurrences (2 or more). 2: plural weekday name, e.g. "Mondays". */
			return sprintf( _n( 'Every %1$d week on %2$s', 'Every %1$d weeks on %2$s', $interval, 'fair-events' ), $interval, $weekday );
		}

		/* translators: 1: number of weeks between occurrences (2 or more). 2: plural weekday name, e.g. "Mondays". 3: start time, e.g. "18:00". */
		return sprintf( _n( 'Every %1$d week on %2$s at %3$s', 'Every %1$d weeks on %2$s at %3$s', $interval, 'fair-events' ), $interval, $weekday, $time );
	}

	/**
	 * Monthly schedule text (the rule repeats on the anchor's day of month).
	 *
	 * @param int    $interval     Rule interval.
	 * @param bool   $all_day      Whether the series is all-day.
	 * @param string $time         Regular start time, 'H:i'.
	 * @param int    $day_of_month Anchor day of month, 1–31.
	 * @return string
	 */
	private static function format_monthly( $interval, $all_day, $time, $day_of_month ) {
		if ( 1 === $interval ) {
			if ( $all_day ) {
				/* translators: %d: day of the month, e.g. 15. */
				return sprintf( __( 'Monthly on day %d', 'fair-events' ), $day_of_month );
			}
			/* translators: 1: day of the month, e.g. 15. 2: start time, e.g. "18:00". */
			return sprintf( __( 'Monthly on day %1$d at %2$s', 'fair-events' ), $day_of_month, $time );
		}

		if ( $all_day ) {
			/* translators: 1: number of months between occurrences (2 or more). 2: day of the month, e.g. 15. */
			return sprintf( _n( 'Every %1$d month on day %2$d', 'Every %1$d months on day %2$d', $interval, 'fair-events' ), $interval, $day_of_month );
		}

		/* translators: 1: number of months between occurrences (2 or more). 2: day of the month, e.g. 15. 3: start time, e.g. "18:00". */
		return sprintf( _n( 'Every %1$d month on day %2$d at %3$s', 'Every %1$d months on day %2$d at %3$s', $interval, 'fair-events' ), $interval, $day_of_month, $time );
	}

	/**
	 * Plural weekday name for "every <weekday>" phrasing.
	 *
	 * @param int $iso_weekday ISO-8601 weekday, 1 (Monday) – 7 (Sunday).
	 * @return string
	 */
	private static function weekday_plural( $iso_weekday ) {
		$names = array(
			1 => _x( 'Mondays', 'recurring weekday', 'fair-events' ),
			2 => _x( 'Tuesdays', 'recurring weekday', 'fair-events' ),
			3 => _x( 'Wednesdays', 'recurring weekday', 'fair-events' ),
			4 => _x( 'Thursdays', 'recurring weekday', 'fair-events' ),
			5 => _x( 'Fridays', 'recurring weekday', 'fair-events' ),
			6 => _x( 'Saturdays', 'recurring weekday', 'fair-events' ),
			7 => _x( 'Sundays', 'recurring weekday', 'fair-events' ),
		);

		return $names[ $iso_weekday ] ?? '';
	}
}
