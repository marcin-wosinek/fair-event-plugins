<?php
/**
 * Events Week summary formatter.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Helpers\DateHelper;

defined( 'WPINC' ) || die;

/**
 * Formats flat occurrence DTOs for the Events Week clipboard summary.
 */
class EventsWeekSummaryFormatter {

	/**
	 * Format a weekly clipboard summary.
	 *
	 * @param array[] $occurrences Flat occurrence DTOs in display order.
	 * @param string  $week_start  Selected week's first date.
	 * @param string  $week_end    Selected week's last date.
	 * @param string  $page_label  Page title, optionally including its URL.
	 * @param string  $nav_title   Navigation date-range title.
	 * @return string Clipboard summary text.
	 */
	public static function format( array $occurrences, $week_start, $week_end, $page_label, $nav_title ) {
		$week_start_date = DateHelper::local_date( $week_start );
		$week_end_date   = DateHelper::local_date( $week_end );
		$summary_lines   = array( $page_label . ', ' . $nav_title . ':' );

		foreach ( $occurrences as $occurrence ) {
			$line = '* ' . self::when( $occurrence, $week_start_date, $week_end_date ) . ', ' . $occurrence['title'];
			if ( ! empty( $occurrence['url'] ) ) {
				$line .= ': ' . $occurrence['url'];
			}

			$summary_lines[] = $line;
		}

		return implode( "\n", $summary_lines );
	}

	/**
	 * Localized weekday (or weekday range, clipped to the week) and, unless the
	 * occurrence is all-day, its start time, e.g. "Mon, 18:00" or "Fri–Sun".
	 *
	 * @param array  $occurrence      Flat occurrence DTO.
	 * @param string $week_start_date Selected week's first 'Y-m-d' date.
	 * @param string $week_end_date   Selected week's last 'Y-m-d' date.
	 * @return string When label.
	 */
	public static function when( array $occurrence, $week_start_date, $week_end_date ) {
		$start_date = max( DateHelper::local_date( $occurrence['start'] ), $week_start_date );
		$end_date   = ! empty( $occurrence['end'] ) ? DateHelper::local_date( $occurrence['end'] ) : $start_date;
		$end_date   = min( $end_date, $week_end_date );

		$start = DateHelper::local_to_datetime( $start_date . ' 00:00:00' );
		$end   = DateHelper::local_to_datetime( $end_date . ' 00:00:00' );

		$when = wp_date( 'D', $start->getTimestamp() );
		if ( $start_date !== $end_date ) {
			$when .= '–' . wp_date( 'D', $end->getTimestamp() );
		}
		if ( empty( $occurrence['all_day'] ) ) {
			$when .= ', ' . DateHelper::local_time( $occurrence['start'] );
		}

		return $when;
	}
}
