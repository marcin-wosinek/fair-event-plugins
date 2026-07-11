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
use FairEvents\Helpers\FairEventsApiParser;
use FairEvents\Helpers\ICalParser;
use FairEvents\Helpers\QueryHelper;
use FairEvents\Models\EventDates;
use FairEvents\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * Service for aggregating a source's events into a 7-day week structure.
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

		// Collect all events.
		$all_events       = array();
		$all_category_ids = array();

		foreach ( $source['data_sources'] as $data_source ) {
			$type = $data_source['source_type'] ?? '';

			if ( 'ical_url' === $type ) {
				$url = $data_source['config']['url'] ?? '';
				if ( ! empty( $url ) ) {
					$this->collect_ical_events( $url, $start_datetime, $end_datetime, $all_events );
				}
			} elseif ( 'fair_events_api' === $type ) {
				$url = $data_source['config']['url'] ?? '';
				if ( ! empty( $url ) ) {
					$this->collect_fair_events_api_events( $url, $week_start, $week_end, $start_datetime, $end_datetime, $all_events );
				}
			} elseif ( 'categories' === $type ) {
				$category_ids = $data_source['config']['category_ids'] ?? array();
				if ( ! empty( $category_ids ) ) {
					$all_category_ids = array_merge( $all_category_ids, $category_ids );
				}
			}
		}

		$all_category_ids = array_unique( array_map( 'intval', $all_category_ids ) );

		// Local events are always part of a source; categories, when configured,
		// act only as a filter — mirrors PublicEventsController::get_source_events().
		$this->collect_local_events( $all_category_ids, $start_datetime, $end_datetime, $all_events );
		$this->collect_standalone_events( $start_datetime, $end_datetime, $all_events, $all_category_ids );

		// Build 7-day response.
		$days         = array();
		$current_date = new \DateTime( $week_start, new \DateTimeZone( wp_timezone_string() ) );

		$tz = new \DateTimeZone( wp_timezone_string() );

		for ( $i = 0; $i < 7; $i++ ) {
			$date_string = $current_date->format( 'Y-m-d' );
			$day_events  = $all_events[ $date_string ] ?? array();

			// Sort by start time.
			usort(
				$day_events,
				function ( $a, $b ) {
					return strcmp( $a['start_time'] ?? '99:99', $b['start_time'] ?? '99:99' );
				}
			);

			// Resolve end_weekday for multi-day events.
			foreach ( $day_events as &$evt ) {
				if ( ! empty( $evt['end_date'] ) ) {
					$end_dt             = new \DateTime( $evt['end_date'], $tz );
					$evt['end_weekday'] = wp_date( 'l', $end_dt->getTimestamp() );
				}
			}
			unset( $evt );

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
	 * Collect iCal events into the events array.
	 *
	 * @param string $url            iCal feed URL.
	 * @param string $start_datetime Week start datetime.
	 * @param string $end_datetime   Week end datetime.
	 * @param array  $all_events     Events grouped by date (modified by reference).
	 */
	private function collect_ical_events( $url, $start_datetime, $end_datetime, &$all_events ) {
		$fetched  = ICalParser::fetch_and_parse( $url );
		$filtered = ICalParser::filter_events_for_month( $fetched, $start_datetime, $end_datetime );

		foreach ( $filtered as $event ) {
			$start_date = DateHelper::local_date( $event['start'] );

			if ( ! isset( $all_events[ $start_date ] ) ) {
				$all_events[ $start_date ] = array();
			}

			$end_date = DateHelper::local_date( $event['end'] );

			$all_events[ $start_date ][] = array(
				'title'         => $event['summary'] ?? '',
				'start_time'    => $event['all_day'] ? '' : DateHelper::local_time( $event['start'] ),
				'end_time'      => $event['all_day'] ? '' : DateHelper::local_time( $event['end'] ),
				'url'           => $event['url'] ?? '',
				'all_day'       => (bool) $event['all_day'],
				'event_id'      => null,
				'event_date_id' => null,
				'end_date'      => $end_date !== $start_date ? $end_date : null,
			);
		}
	}

	/**
	 * Collect events from a Fair Events API endpoint.
	 *
	 * @param string $url            Fair Events API URL.
	 * @param string $week_start     Week start date (Y-m-d).
	 * @param string $week_end       Week end date (Y-m-d).
	 * @param string $start_datetime Week start datetime.
	 * @param string $end_datetime   Week end datetime.
	 * @param array  $all_events     Events grouped by date (modified by reference).
	 */
	private function collect_fair_events_api_events( $url, $week_start, $week_end, $start_datetime, $end_datetime, &$all_events ) {
		$fetched  = FairEventsApiParser::fetch_and_parse( $url, $week_start, $week_end );
		$filtered = FairEventsApiParser::filter_events_for_month( $fetched, $start_datetime, $end_datetime );

		foreach ( $filtered as $event ) {
			$start_date = DateHelper::local_date( $event['start'] );

			if ( ! isset( $all_events[ $start_date ] ) ) {
				$all_events[ $start_date ] = array();
			}

			$end_date = DateHelper::local_date( $event['end'] );

			$all_events[ $start_date ][] = array(
				'title'         => $event['summary'] ?? '',
				'start_time'    => $event['all_day'] ? '' : DateHelper::local_time( $event['start'] ),
				'end_time'      => $event['all_day'] ? '' : DateHelper::local_time( $event['end'] ),
				'url'           => $event['url'] ?? '',
				'all_day'       => (bool) $event['all_day'],
				'event_id'      => null,
				'event_date_id' => null,
				'end_date'      => $end_date !== $start_date ? $end_date : null,
			);
		}
	}

	/**
	 * Collect WordPress post events, optionally filtered by categories.
	 *
	 * @param array  $category_ids   Category term IDs to filter by. Empty means no filter.
	 * @param string $start_datetime Week start datetime.
	 * @param string $end_datetime   Week end datetime.
	 * @param array  $all_events     Events grouped by date (modified by reference).
	 */
	private function collect_local_events( $category_ids, $start_datetime, $end_datetime, &$all_events ) {
		$query_args = array(
			'post_type'              => Settings::get_enabled_post_types(),
			'posts_per_page'         => -1,
			'post_status'            => 'publish',
			'fair_events_date_query' => array(
				'start_before' => $end_datetime,
				'end_after'    => $start_datetime,
			),
			'fair_events_order'      => 'ASC',
		);

		if ( ! empty( $category_ids ) ) {
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
			$query_args['tax_query'] = array(
				array(
					'taxonomy'         => 'category',
					'field'            => 'term_id',
					'terms'            => $category_ids,
					'include_children' => false,
				),
			);
		}

		add_filter( 'posts_join', array( QueryHelper::class, 'join_dates_table' ), 10, 2 );
		add_filter( 'posts_where', array( QueryHelper::class, 'filter_by_dates' ), 10, 2 );
		add_filter( 'posts_orderby', array( QueryHelper::class, 'order_by_dates' ), 10, 2 );

		$query = new \WP_Query( $query_args );

		remove_filter( 'posts_join', array( QueryHelper::class, 'join_dates_table' ), 10 );
		remove_filter( 'posts_where', array( QueryHelper::class, 'filter_by_dates' ), 10 );
		remove_filter( 'posts_orderby', array( QueryHelper::class, 'order_by_dates' ), 10 );

		$processed = array();

		if ( $query->have_posts() ) {
			while ( $query->have_posts() ) {
				$query->the_post();
				$event_id = get_the_ID();

				if ( isset( $processed[ $event_id ] ) ) {
					continue;
				}
				$processed[ $event_id ] = true;

				$occurrences = EventDates::get_all_by_event_id( $event_id );

				foreach ( $occurrences as $event_dates ) {
					$start_date = DateHelper::local_date( $event_dates->start_datetime );

					if ( ! isset( $all_events[ $start_date ] ) ) {
						$all_events[ $start_date ] = array();
					}

					$is_all_day = (bool) $event_dates->all_day;
					$start_time = $is_all_day ? '' : DateHelper::local_time( $event_dates->start_datetime );
					$end_time   = '';
					if ( ! $is_all_day && $event_dates->end_datetime ) {
						$end_time = DateHelper::local_time( $event_dates->end_datetime );
					}

					$end_date = $event_dates->end_datetime ? DateHelper::local_date( $event_dates->end_datetime ) : null;

					$all_events[ $start_date ][] = array(
						'title'         => get_the_title( $event_id ),
						'start_time'    => $start_time,
						'end_time'      => $end_time,
						'url'           => get_permalink( $event_id ),
						'all_day'       => $is_all_day,
						'event_id'      => $event_id,
						'event_date_id' => (int) $event_dates->id,
						'end_date'      => $end_date !== $start_date ? $end_date : null,
					);
				}
			}
		}

		wp_reset_postdata();
	}

	/**
	 * Collect standalone events (external/unlinked).
	 *
	 * @param string $start_datetime Week start datetime.
	 * @param string $end_datetime   Week end datetime.
	 * @param array  $all_events     Events grouped by date (modified by reference).
	 * @param array  $category_ids   Optional category term IDs to filter by.
	 */
	private function collect_standalone_events( $start_datetime, $end_datetime, &$all_events, $category_ids = array() ) {
		$standalone = EventDates::get_standalone_for_date_range( $start_datetime, $end_datetime, $category_ids );

		foreach ( $standalone as $event_dates ) {
			$start_date = DateHelper::local_date( $event_dates->start_datetime );

			if ( ! isset( $all_events[ $start_date ] ) ) {
				$all_events[ $start_date ] = array();
			}

			$is_all_day = (bool) $event_dates->all_day;
			$start_time = $is_all_day ? '' : DateHelper::local_time( $event_dates->start_datetime );
			$end_time   = '';
			if ( ! $is_all_day && $event_dates->end_datetime ) {
				$end_time = DateHelper::local_time( $event_dates->end_datetime );
			}

			$end_date = $event_dates->end_datetime ? DateHelper::local_date( $event_dates->end_datetime ) : null;

			$all_events[ $start_date ][] = array(
				'title'         => $event_dates->get_display_title(),
				'start_time'    => $start_time,
				'end_time'      => $end_time,
				'url'           => $event_dates->get_display_url(),
				'all_day'       => $is_all_day,
				'event_id'      => null,
				'event_date_id' => (int) $event_dates->id,
				'end_date'      => $end_date !== $start_date ? $end_date : null,
			);
		}
	}
}
