<?php
/**
 * Events Week summary builder.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Helpers\DateHelper;

defined( 'WPINC' ) || die;

/**
 * Week boundaries, heading and summary text shared by the Events Week block's
 * copy-summary action and scheduled weekly notifications, so both produce the
 * same text for the same week, filters and page.
 *
 * A week is seven days starting on the site's configured first weekday
 * (Settings::get_start_of_week()). Dates are naive site-local 'Y-m-d' strings.
 */
class EventsWeekSummary {

	/**
	 * Boundaries of the configured week that the block shows for an ISO week.
	 *
	 * @param int $year          ISO week-numbering year.
	 * @param int $week          ISO week number.
	 * @param int $start_of_week First weekday, from Sunday (0) to Saturday (6).
	 * @return array{start: string, end: string} Week start and end dates.
	 */
	public static function iso_week_boundaries( $year, $week, $start_of_week ) {
		$date = new \DateTime( 'now', new \DateTimeZone( 'UTC' ) );
		$date->setISODate( (int) $year, (int) $week );
		// setISODate() lands on the Monday (weekday 1). Step back to whichever
		// weekday start_of_week configures (0 = Sunday .. 6 = Saturday).
		$days_back = ( 1 - (int) $start_of_week + 7 ) % 7;
		if ( $days_back > 0 ) {
			$date->modify( "-{$days_back} days" );
		}

		return self::boundaries_from_start( $date->format( 'Y-m-d' ) );
	}

	/**
	 * Boundaries of the configured week containing a date.
	 *
	 * @param string $date          Site-local 'Y-m-d' date.
	 * @param int    $start_of_week First weekday, from Sunday (0) to Saturday (6).
	 * @return array{start: string, end: string} Week start and end dates.
	 */
	public static function boundaries_containing( $date, $start_of_week ) {
		$day       = new \DateTime( $date, new \DateTimeZone( 'UTC' ) );
		$days_back = ( (int) $day->format( 'w' ) - (int) $start_of_week + 7 ) % 7;
		if ( $days_back > 0 ) {
			$day->modify( "-{$days_back} days" );
		}

		return self::boundaries_from_start( $day->format( 'Y-m-d' ) );
	}

	/**
	 * Offset an ISO week by a number of weeks.
	 *
	 * @param int $year   ISO week-numbering year.
	 * @param int $week   ISO week number.
	 * @param int $offset Number of weeks to offset.
	 * @return array{year: int, week: int} Offset ISO year and week.
	 */
	public static function offset_iso_week( $year, $week, $offset ) {
		$date = new \DateTime( 'now', new \DateTimeZone( 'UTC' ) );
		$date->setISODate( (int) $year, (int) $week );
		$date->modify( sprintf( '%+d weeks', (int) $offset ) );

		return array(
			'year' => (int) $date->format( 'o' ),
			'week' => (int) $date->format( 'W' ),
		);
	}

	/**
	 * Localized date-range heading, e.g. "16–22 Jun 2026".
	 *
	 * @param string $start_date Site-local 'Y-m-d' first day.
	 * @param string $end_date   Site-local 'Y-m-d' last day.
	 * @return string Range title.
	 */
	public static function range_title( $start_date, $end_date ) {
		// Midnight in the site timezone, so wp_date() formats the same
		// calendar day whatever the site's UTC offset.
		$start_ts = DateHelper::local_to_datetime( $start_date . ' 00:00:00' )->getTimestamp();
		$end_ts   = DateHelper::local_to_datetime( $end_date . ' 00:00:00' )->getTimestamp();

		$start_month = wp_date( 'M', $start_ts );
		$end_month   = wp_date( 'M', $end_ts );
		$start_year  = wp_date( 'Y', $start_ts );
		$end_year    = wp_date( 'Y', $end_ts );
		$start_day   = wp_date( 'j', $start_ts );
		$end_day     = wp_date( 'j', $end_ts );

		if ( $start_year !== $end_year || $start_month !== $end_month ) {
			return sprintf( '%s %s – %s %s %s', $start_day, $start_month, $end_day, $end_month, $end_year );
		}

		return sprintf( '%s–%s %s %s', $start_day, $end_day, $end_month, $end_year );
	}

	/**
	 * Summary heading label for a page: its title, followed by its URL.
	 *
	 * @param int $page_id Page (or other post) ID.
	 * @return string Page label.
	 */
	public static function page_label( $page_id ) {
		$page_title = get_the_title( $page_id );
		$page_url   = get_permalink( $page_id );

		return $page_url ? $page_title . ' (' . $page_url . ')' : $page_title;
	}

	/**
	 * Occurrences shown for a week, translated to a language.
	 *
	 * @param array{start: string, end: string} $boundaries Week boundaries.
	 * @param array                             $filters    EventFeedProvider::get_occurrences() filters.
	 * @param string|false|null                 $language   Polylang language slug, or null for the
	 *                                                      current front-end language.
	 * @return array[] Flat occurrence DTOs in display order.
	 */
	public static function occurrences( array $boundaries, array $filters, $language = null ) {
		$provider    = new EventFeedProvider();
		$occurrences = $provider->get_occurrences(
			$boundaries['start'] . ' 00:00:00',
			$boundaries['end'] . ' 23:59:59',
			$filters
		);

		return null === $language
			? EventTranslation::translate_occurrences( $occurrences )
			: EventTranslation::translate_occurrences_to_language( $occurrences, $language );
	}

	/**
	 * Format the copy-summary text for a week's occurrences.
	 *
	 * @param array[]                           $occurrences Occurrences from occurrences().
	 * @param array{start: string, end: string} $boundaries  Week boundaries.
	 * @param string                            $page_label  Heading label from page_label().
	 * @return string Summary text.
	 */
	public static function format( array $occurrences, array $boundaries, $page_label ) {
		return EventsWeekSummaryFormatter::format(
			$occurrences,
			$boundaries['start'] . ' 00:00:00',
			$boundaries['end'] . ' 23:59:59',
			$page_label,
			self::range_title( $boundaries['start'], $boundaries['end'] )
		);
	}

	/**
	 * Start and end dates of a week beginning on a date.
	 *
	 * @param string $start_date 'Y-m-d' first day.
	 * @return array{start: string, end: string} Week start and end dates.
	 */
	private static function boundaries_from_start( $start_date ) {
		$end = new \DateTime( $start_date, new \DateTimeZone( 'UTC' ) );
		$end->modify( '+6 days' );

		return array(
			'start' => $start_date,
			'end'   => $end->format( 'Y-m-d' ),
		);
	}
}
