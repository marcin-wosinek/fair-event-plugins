<?php
/**
 * Weekly Events Provider
 *
 * Aggregates events for a given event source grouped by day for a specific ISO week.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Database\EventSourceRepository;
use FairEvents\Helpers\DateHelper;

defined( 'WPINC' ) || die;

/**
 * Service for aggregating a source's events into a 7-day week structure.
 *
 * Reimplemented on top of EventFeedProvider + group_by_day(); the public
 * return shape is preserved exactly since fair-audience's weekly digest
 * (WeeklyDigestHooks, WeeklyDigestController, WeeklyDigestRenderer) consumes
 * it directly.
 */
class WeeklyEventsProvider {

	/**
	 * Get the week's events for an event source.
	 *
	 * @param string   $source_slug Event source slug.
	 * @param int|null $year        ISO year, or null for the current week.
	 * @param int|null $week        ISO week number, or null for the current week.
	 * @return array|\WP_Error Array with 'source', 'week', 'days' keys, or WP_Error if the source is not found.
	 */
	public function get_week( $source_slug, $year = null, $week = null ) {
		$repository = new EventSourceRepository();
		$source     = $repository->get_by_slug( $source_slug );

		if ( ! $source ) {
			return new \WP_Error(
				'not_found',
				__( 'Event source not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		if ( ! $year || ! $week ) {
			$now  = new \DateTime( 'now', new \DateTimeZone( wp_timezone_string() ) );
			$year = (int) $now->format( 'o' );
			$week = (int) $now->format( 'W' );
		}

		// Calculate week boundaries (Monday-based).
		$date = new \DateTime();
		$date->setISODate( $year, $week );
		$week_start = $date->format( 'Y-m-d' );
		$date->modify( '+6 days' );
		$week_end = $date->format( 'Y-m-d' );

		$start_datetime = $week_start . ' 00:00:00';
		$end_datetime   = $week_end . ' 23:59:59';

		$provider    = new EventFeedProvider();
		$occurrences = $provider->get_occurrences(
			$start_datetime,
			$end_datetime,
			array(
				'event_source_slugs' => array( $source_slug ),
			)
		);

		$occurrences_by_date = EventFeedProvider::group_by_day( $occurrences, $start_datetime, $end_datetime );

		// Build 7-day response.
		$days         = array();
		$current_date = new \DateTime( $week_start, new \DateTimeZone( wp_timezone_string() ) );
		$tz           = new \DateTimeZone( wp_timezone_string() );

		for ( $i = 0; $i < 7; $i++ ) {
			$date_string = $current_date->format( 'Y-m-d' );
			$day_events  = array_map(
				function ( $occurrence ) use ( $tz ) {
					return $this->format_day_event( $occurrence, $tz );
				},
				$occurrences_by_date[ $date_string ] ?? array()
			);

			$days[] = array(
				'date'       => $date_string,
				'weekday'    => wp_date( 'l', $current_date->getTimestamp() ),
				'day_num'    => (int) $current_date->format( 'j' ),
				'month_name' => wp_date( 'F', $current_date->getTimestamp() ),
				'events'     => $day_events,
			);

			$current_date->modify( '+1 day' );
		}

		return array(
			'source' => array(
				'name'     => $source['name'],
				'slug'     => $source['slug'],
				'page_url' => $source['page_id'] ? get_permalink( $source['page_id'] ) : null,
			),
			'week'   => array(
				'year'  => $year,
				'week'  => $week,
				'start' => $week_start,
				'end'   => $week_end,
			),
			'days'   => $days,
		);
	}

	/**
	 * Parse ISO week string (e.g., "2026-W07").
	 *
	 * @param string|null $iso_week ISO week string.
	 * @return array|null Array with 'year' and 'week', or null.
	 */
	public function parse_iso_week( $iso_week ) {
		if ( ! $iso_week || ! preg_match( '/^(\d{4})-W(\d{2})$/', $iso_week, $matches ) ) {
			return null;
		}

		$year = (int) $matches[1];
		$week = (int) $matches[2];

		if ( $year < 1900 || $year > 2100 || $week < 1 || $week > 53 ) {
			return null;
		}

		return array(
			'year' => $year,
			'week' => $week,
		);
	}

	/**
	 * Map an EventFeedProvider occurrence DTO to the digest's day-event shape.
	 *
	 * @param array         $occurrence Occurrence DTO from EventFeedProvider (with
	 *                                  is_first_day/is_last_day added by group_by_day()).
	 * @param \DateTimeZone $tz         Site timezone, for resolving end_weekday.
	 * @return array Day-event shape: title, start_time, end_time, url, all_day,
	 *               event_id, event_date_id, end_date, end_weekday.
	 */
	private function format_day_event( $occurrence, $tz ) {
		$start_date = DateHelper::local_date( $occurrence['start'] );
		$end_date   = ! empty( $occurrence['end'] ) ? DateHelper::local_date( $occurrence['end'] ) : $start_date;
		$is_all_day = (bool) $occurrence['all_day'];

		$end_weekday = null;
		if ( $end_date !== $start_date ) {
			$end_dt      = new \DateTime( $end_date, $tz );
			$end_weekday = wp_date( 'l', $end_dt->getTimestamp() );
		}

		return array(
			'title'         => $occurrence['title'],
			'start_time'    => $is_all_day ? '' : DateHelper::local_time( $occurrence['start'] ),
			'end_time'      => ( $is_all_day || empty( $occurrence['end'] ) ) ? '' : DateHelper::local_time( $occurrence['end'] ),
			'url'           => $occurrence['url'],
			'all_day'       => $is_all_day,
			'event_id'      => $occurrence['event_id'],
			'event_date_id' => $occurrence['event_date_id'],
			'end_date'      => $end_date !== $start_date ? $end_date : null,
			'end_weekday'   => $end_weekday,
		);
	}
}
