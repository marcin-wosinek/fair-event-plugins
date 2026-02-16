<?php
/**
 * Weekly Events Controller
 *
 * Returns events for a given event source grouped by day for a specific ISO week.
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Database\EventSourceRepository;
use FairEvents\Helpers\DateHelper;
use FairEvents\Helpers\FairEventsApiParser;
use FairEvents\Helpers\ICalParser;
use FairEvents\Helpers\QueryHelper;
use FairEvents\Models\EventDates;
use FairEvents\Settings\Settings;

/**
 * REST controller for weekly events aggregation.
 */
class WeeklyEventsController extends \WP_REST_Controller {

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->namespace = 'fair-events/v1';
		$this->rest_base = 'weekly-events';
	}

	/**
	 * Register routes.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => \WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'source' => array(
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'week'   => array(
							'required'          => false,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Permission check.
	 *
	 * @param \WP_REST_Request $request Request object.
	 * @return bool
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Get weekly events.
	 *
	 * @param \WP_REST_Request $request Request object.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function get_items( $request ) {
		$slug       = $request->get_param( 'source' );
		$week_param = $request->get_param( 'week' );

		// Resolve event source.
		$repository = new EventSourceRepository();
		$source     = $repository->get_by_slug( $slug );

		if ( ! $source ) {
			return new \WP_Error(
				'not_found',
				__( 'Event source not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Parse week parameter or use current week.
		$parsed = $this->parse_iso_week( $week_param );
		if ( ! $parsed ) {
			$now  = new \DateTime( 'now', new \DateTimeZone( wp_timezone_string() ) );
			$year = (int) $now->format( 'o' );
			$week = (int) $now->format( 'W' );
		} else {
			$year = $parsed['year'];
			$week = $parsed['week'];
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
					$this->collect_category_events( $category_ids, $start_datetime, $end_datetime, $all_events );
					$all_category_ids = array_merge( $all_category_ids, $category_ids );
				}
			}
		}

		// Fetch standalone events filtered by collected category IDs.
		if ( ! empty( $all_category_ids ) ) {
			$all_category_ids = array_unique( array_map( 'intval', $all_category_ids ) );
			$this->collect_standalone_events( $start_datetime, $end_datetime, $all_events, $all_category_ids );
		}

		// Build 7-day response.
		$days         = array();
		$current_date = new \DateTime( $week_start, new \DateTimeZone( wp_timezone_string() ) );

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

			$days[] = array(
				'date'       => $date_string,
				'weekday'    => wp_date( 'l', $current_date->getTimestamp() ),
				'day_num'    => (int) $current_date->format( 'j' ),
				'month_name' => wp_date( 'F', $current_date->getTimestamp() ),
				'events'     => $day_events,
			);

			$current_date->modify( '+1 day' );
		}

		return rest_ensure_response(
			array(
				'source' => array(
					'name' => $source['name'],
					'slug' => $source['slug'],
				),
				'week'   => array(
					'year'  => $year,
					'week'  => $week,
					'start' => $week_start,
					'end'   => $week_end,
				),
				'days'   => $days,
			)
		);
	}

	/**
	 * Parse ISO week string (e.g., "2026-W07").
	 *
	 * @param string|null $iso_week ISO week string.
	 * @return array|null Array with 'year' and 'week', or null.
	 */
	private function parse_iso_week( $iso_week ) {
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

			$all_events[ $start_date ][] = array(
				'title'      => $event['summary'] ?? '',
				'start_time' => $event['all_day'] ? '' : DateHelper::local_time( $event['start'] ),
				'end_time'   => $event['all_day'] ? '' : DateHelper::local_time( $event['end'] ),
				'url'        => $event['url'] ?? '',
				'all_day'    => (bool) $event['all_day'],
				'event_id'   => null,
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

			$all_events[ $start_date ][] = array(
				'title'      => $event['summary'] ?? '',
				'start_time' => $event['all_day'] ? '' : DateHelper::local_time( $event['start'] ),
				'end_time'   => $event['all_day'] ? '' : DateHelper::local_time( $event['end'] ),
				'url'        => $event['url'] ?? '',
				'all_day'    => (bool) $event['all_day'],
				'event_id'   => null,
			);
		}
	}

	/**
	 * Collect WordPress post events filtered by categories.
	 *
	 * @param array  $category_ids   Category term IDs.
	 * @param string $start_datetime Week start datetime.
	 * @param string $end_datetime   Week end datetime.
	 * @param array  $all_events     Events grouped by date (modified by reference).
	 */
	private function collect_category_events( $category_ids, $start_datetime, $end_datetime, &$all_events ) {
		$query_args = array(
			'post_type'              => Settings::get_enabled_post_types(),
			'posts_per_page'         => -1,
			'post_status'            => 'publish',
			'fair_events_date_query' => array(
				'start_before' => $end_datetime,
				'end_after'    => $start_datetime,
			),
			'fair_events_order'      => 'ASC',
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
			'tax_query'              => array(
				array(
					'taxonomy'         => 'category',
					'field'            => 'term_id',
					'terms'            => $category_ids,
					'include_children' => false,
				),
			),
		);

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

					$all_events[ $start_date ][] = array(
						'title'      => get_the_title( $event_id ),
						'start_time' => $start_time,
						'end_time'   => $end_time,
						'url'        => get_permalink( $event_id ),
						'all_day'    => $is_all_day,
						'event_id'   => $event_id,
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

			$all_events[ $start_date ][] = array(
				'title'      => $event_dates->get_display_title(),
				'start_time' => $start_time,
				'end_time'   => $end_time,
				'url'        => $event_dates->get_display_url(),
				'all_day'    => $is_all_day,
				'event_id'   => null,
			);
		}
	}
}
