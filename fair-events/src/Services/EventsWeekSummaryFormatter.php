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
			$start_date = max( DateHelper::local_date( $occurrence['start'] ), $week_start_date );
			$end_date   = ! empty( $occurrence['end'] ) ? DateHelper::local_date( $occurrence['end'] ) : $start_date;
			$end_date   = min( $end_date, $week_end_date );

			$start = DateHelper::local_to_datetime( $start_date . ' 00:00:00' );
			$end   = DateHelper::local_to_datetime( $end_date . ' 00:00:00' );

			$weekday = wp_date( 'D', $start->getTimestamp() );
			if ( $start_date !== $end_date ) {
				$weekday .= '–' . wp_date( 'D', $end->getTimestamp() );
			}

			$line = '* ' . $weekday;
			if ( empty( $occurrence['all_day'] ) ) {
				$line .= ', ' . DateHelper::local_time( $occurrence['start'] );
			}
			$line .= ', ' . $occurrence['title'];
			if ( ! empty( $occurrence['url'] ) ) {
				$line .= ': ' . $occurrence['url'];
			}

			$summary_lines[] = $line;
		}

		return implode( "\n", $summary_lines );
	}
}
