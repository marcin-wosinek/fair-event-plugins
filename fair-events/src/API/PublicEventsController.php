<?php
/**
 * REST API Controller for Public Events JSON Export
 *
 * Provides public JSON endpoints for sharing events between Fair Events sites.
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Database\EventSourceRepository;
use FairEvents\Models\EventDates;
use FairEvents\Settings\Settings;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles public events JSON API endpoints
 */
class PublicEventsController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Register the routes for public events
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-events/v1/events - Global endpoint for all public events
		register_rest_route(
			$this->namespace,
			'/events',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_events' ),
					'permission_callback' => '__return_true', // Public endpoint
					'args'                => array(
						'start_date' => array(
							'description' => __( 'Filter events starting on or after this date (Y-m-d format).', 'fair-events' ),
							'type'        => 'string',
							'format'      => 'date',
						),
						'end_date'   => array(
							'description' => __( 'Filter events ending on or before this date (Y-m-d format).', 'fair-events' ),
							'type'        => 'string',
							'format'      => 'date',
						),
						'categories' => array(
							'description' => __( 'Filter by category slugs (comma-separated).', 'fair-events' ),
							'type'        => 'string',
						),
						'per_page'   => array(
							'description' => __( 'Number of events per page.', 'fair-events' ),
							'type'        => 'integer',
							'default'     => 100,
							'minimum'     => 1,
							'maximum'     => 500,
						),
						'page'       => array(
							'description' => __( 'Page number.', 'fair-events' ),
							'type'        => 'integer',
							'default'     => 1,
							'minimum'     => 1,
						),
					),
				),
			)
		);

		// GET /fair-events/v1/sources/{slug}/json - Source-based endpoint
		register_rest_route(
			$this->namespace,
			'/sources/(?P<slug>[a-z0-9-]+)/json',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_source_events' ),
					'permission_callback' => '__return_true', // Public endpoint
					'args'                => array(
						'slug'       => array(
							'description' => __( 'Unique slug identifier for the source.', 'fair-events' ),
							'type'        => 'string',
							'required'    => true,
						),
						'start_date' => array(
							'description' => __( 'Filter events starting on or after this date (Y-m-d format).', 'fair-events' ),
							'type'        => 'string',
							'format'      => 'date',
						),
						'end_date'   => array(
							'description' => __( 'Filter events ending on or before this date (Y-m-d format).', 'fair-events' ),
							'type'        => 'string',
							'format'      => 'date',
						),
						'per_page'   => array(
							'description' => __( 'Number of events per page.', 'fair-events' ),
							'type'        => 'integer',
							'default'     => 100,
							'minimum'     => 1,
							'maximum'     => 500,
						),
						'page'       => array(
							'description' => __( 'Page number.', 'fair-events' ),
							'type'        => 'integer',
							'default'     => 1,
							'minimum'     => 1,
						),
					),
				),
			)
		);
	}

	/**
	 * Get all public events
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_events( $request ) {
		$start_date = $request->get_param( 'start_date' );
		$end_date   = $request->get_param( 'end_date' );
		$categories = $request->get_param( 'categories' );
		$per_page   = $request->get_param( 'per_page' );
		$page       = $request->get_param( 'page' );

		// Parse categories if provided
		$category_ids = array();
		if ( ! empty( $categories ) ) {
			$category_slugs = array_map( 'trim', explode( ',', $categories ) );
			foreach ( $category_slugs as $slug ) {
				$term = get_term_by( 'slug', $slug, 'category' );
				if ( $term ) {
					$category_ids[] = $term->term_id;
				}
			}
		}

		$events = $this->query_events( $start_date, $end_date, $category_ids, $per_page, $page );

		return $this->build_response( $events, $per_page, $page );
	}

	/**
	 * Get events filtered by event source
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_source_events( $request ) {
		$slug       = $request->get_param( 'slug' );
		$start_date = $request->get_param( 'start_date' );
		$end_date   = $request->get_param( 'end_date' );
		$per_page   = $request->get_param( 'per_page' );
		$page       = $request->get_param( 'page' );

		$repository = new EventSourceRepository();
		$source     = $repository->get_by_slug( $slug );

		if ( ! $source ) {
			return new WP_Error(
				'rest_source_not_found',
				__( 'Source not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		if ( ! $source['enabled'] ) {
			return new WP_Error(
				'rest_source_disabled',
				__( 'This source is disabled.', 'fair-events' ),
				array( 'status' => 403 )
			);
		}

		// Collect category IDs from source data sources
		$category_ids = array();
		foreach ( $source['data_sources'] as $data_source ) {
			if ( 'categories' === $data_source['source_type'] && isset( $data_source['config']['category_ids'] ) ) {
				$category_ids = array_merge( $category_ids, $data_source['config']['category_ids'] );
			}
		}

		$events = $this->query_events( $start_date, $end_date, array_unique( $category_ids ), $per_page, $page );

		return $this->build_response( $events, $per_page, $page );
	}

	/**
	 * Query events from database
	 *
	 * @param string|null $start_date Start date filter (Y-m-d).
	 * @param string|null $end_date   End date filter (Y-m-d).
	 * @param array       $category_ids Category IDs to filter by.
	 * @param int         $per_page   Number of events per page.
	 * @param int         $page       Page number.
	 * @return array Array of event data.
	 */
	private function query_events( $start_date, $end_date, $category_ids, $per_page, $page ) {
		// Build date query - always use QueryHelper for proper dates table integration
		$date_query = array();

		if ( $start_date ) {
			$date_query['end_after'] = $start_date . ' 00:00:00';
		}

		if ( $end_date ) {
			$date_query['start_before'] = $end_date . ' 23:59:59';
		}

		$query_args = array(
			'post_type'              => Settings::get_enabled_post_types(),
			'posts_per_page'         => $per_page,
			'paged'                  => $page,
			'post_status'            => 'publish',
			'fair_events_date_query' => $date_query,
			'fair_events_order'      => 'ASC',
		);

		// Add category filter if categories are specified
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

		// Hook in the QueryHelper filters for dates table
		add_filter( 'posts_join', array( 'FairEvents\\Helpers\\QueryHelper', 'join_dates_table' ), 10, 2 );
		add_filter( 'posts_where', array( 'FairEvents\\Helpers\\QueryHelper', 'filter_by_dates' ), 10, 2 );
		add_filter( 'posts_orderby', array( 'FairEvents\\Helpers\\QueryHelper', 'order_by_dates' ), 10, 2 );

		$events_query = new \WP_Query( $query_args );

		// Remove filters
		remove_filter( 'posts_join', array( 'FairEvents\\Helpers\\QueryHelper', 'join_dates_table' ), 10 );
		remove_filter( 'posts_where', array( 'FairEvents\\Helpers\\QueryHelper', 'filter_by_dates' ), 10 );
		remove_filter( 'posts_orderby', array( 'FairEvents\\Helpers\\QueryHelper', 'order_by_dates' ), 10 );

		$events = array();
		if ( $events_query->have_posts() ) {
			while ( $events_query->have_posts() ) {
				$events_query->the_post();
				$events[] = $this->format_event( get_the_ID() );
			}
		}

		wp_reset_postdata();

		return $events;
	}

	/**
	 * Format a single event for JSON response
	 *
	 * @param int $event_id Event post ID.
	 * @return array Formatted event data.
	 */
	private function format_event( $event_id ) {
		$event_dates = EventDates::get_by_event_id( $event_id );
		$event_post  = get_post( $event_id );

		$start_datetime = $event_dates ? $event_dates->start_datetime : '';
		$end_datetime   = $event_dates ? $event_dates->end_datetime : $start_datetime;

		// Determine if all-day event (no time component or midnight-to-midnight)
		$all_day = false;
		if ( $start_datetime ) {
			$start_time = gmdate( 'H:i:s', strtotime( $start_datetime ) );
			$end_time   = $end_datetime ? gmdate( 'H:i:s', strtotime( $end_datetime ) ) : '00:00:00';
			$all_day    = ( '00:00:00' === $start_time && '00:00:00' === $end_time );
		}

		// Get excerpt or truncated content
		$description = '';
		if ( has_excerpt( $event_id ) ) {
			$description = get_the_excerpt( $event_id );
		} elseif ( $event_post->post_content ) {
			$description = wp_trim_words( wp_strip_all_tags( $event_post->post_content ), 30 );
		}

		// Generate unique ID for cross-site reference
		$site_host = wp_parse_url( get_site_url(), PHP_URL_HOST );
		$uid       = 'fair_event_' . $event_id . '@' . $site_host;

		return array(
			'uid'         => $uid,
			'title'       => get_the_title( $event_id ),
			'description' => $description,
			'start'       => $start_datetime ? gmdate( 'c', strtotime( $start_datetime ) ) : '',
			'end'         => $end_datetime ? gmdate( 'c', strtotime( $end_datetime ) ) : '',
			'all_day'     => $all_day,
			'url'         => get_permalink( $event_id ),
		);
	}

	/**
	 * Build the JSON response with metadata
	 *
	 * @param array $events   Array of formatted event data.
	 * @param int   $per_page Number of events per page.
	 * @param int   $page     Current page number.
	 * @return WP_REST_Response Response object.
	 */
	private function build_response( $events, $per_page, $page ) {
		$response_data = array(
			'meta'   => array(
				'site_name' => get_bloginfo( 'name' ),
				'site_url'  => get_site_url(),
				'total'     => count( $events ),
				'page'      => $page,
				'per_page'  => $per_page,
			),
			'events' => $events,
		);

		return new WP_REST_Response( $response_data, 200 );
	}
}
