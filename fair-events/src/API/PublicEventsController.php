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
	 * Queries the fair_event_dates table directly to get each occurrence
	 * with its specific dates, then joins with posts for event details.
	 *
	 * @param string|null $start_date Start date filter (Y-m-d).
	 * @param string|null $end_date   End date filter (Y-m-d).
	 * @param array       $category_ids Category IDs to filter by.
	 * @param int         $per_page   Number of events per page.
	 * @param int         $page       Page number.
	 * @return array Array of event data.
	 */
	private function query_events( $start_date, $end_date, $category_ids, $per_page, $page ) {
		global $wpdb;

		$dates_table = $wpdb->prefix . 'fair_event_dates';
		$offset      = ( $page - 1 ) * $per_page;

		// Get enabled post types for filtering.
		$enabled_post_types     = Settings::get_enabled_post_types();
		$post_type_placeholders = implode( ', ', array_fill( 0, count( $enabled_post_types ), '%s' ) );

		// Build WHERE conditions.
		$where_conditions = array(
			"{$wpdb->posts}.post_status = 'publish'",
		);
		$where_values     = array();

		// Post type filter.
		$where_conditions[] = "{$wpdb->posts}.post_type IN ({$post_type_placeholders})";
		$where_values       = array_merge( $where_values, $enabled_post_types );

		// Date range filters.
		if ( $start_date ) {
			$where_conditions[] = "{$dates_table}.end_datetime >= %s";
			$where_values[]     = $start_date . ' 00:00:00';
		}

		if ( $end_date ) {
			$where_conditions[] = "{$dates_table}.start_datetime <= %s";
			$where_values[]     = $end_date . ' 23:59:59';
		}

		// Category filter via subquery.
		if ( ! empty( $category_ids ) ) {
			$category_placeholders = implode( ', ', array_fill( 0, count( $category_ids ), '%d' ) );
			$where_conditions[]    = "{$wpdb->posts}.ID IN (
				SELECT object_id FROM {$wpdb->term_relationships}
				WHERE term_taxonomy_id IN (
					SELECT term_taxonomy_id FROM {$wpdb->term_taxonomy}
					WHERE term_id IN ({$category_placeholders})
				)
			)";
			$where_values          = array_merge( $where_values, $category_ids );
		}

		$where_clause = implode( ' AND ', $where_conditions );

		// Query occurrences directly from dates table with post data.
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$query = $wpdb->prepare(
			"SELECT
				{$dates_table}.id as occurrence_id,
				{$dates_table}.event_id,
				{$dates_table}.start_datetime,
				{$dates_table}.end_datetime,
				{$dates_table}.all_day,
				{$dates_table}.occurrence_type,
				{$wpdb->posts}.post_title,
				{$wpdb->posts}.post_content,
				{$wpdb->posts}.post_excerpt
			FROM {$dates_table}
			INNER JOIN {$wpdb->posts} ON {$dates_table}.event_id = {$wpdb->posts}.ID
			WHERE {$where_clause}
			ORDER BY {$dates_table}.start_datetime ASC
			LIMIT %d OFFSET %d",
			array_merge( $where_values, array( $per_page, $offset ) )
		);

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$results = $wpdb->get_results( $query );

		$events = array();
		if ( $results ) {
			foreach ( $results as $row ) {
				$events[] = $this->format_occurrence( $row );
			}
		}

		return $events;
	}

	/**
	 * Format an occurrence row for JSON response
	 *
	 * @param object $row Database row with occurrence and post data.
	 * @return array Formatted event data.
	 */
	private function format_occurrence( $row ) {
		$start_datetime = $row->start_datetime;
		$end_datetime   = $row->end_datetime ?: $start_datetime;

		// Determine if all-day event.
		$all_day = (bool) $row->all_day;
		if ( ! $all_day && $start_datetime ) {
			// Also check for midnight-to-midnight pattern.
			$start_time = gmdate( 'H:i:s', strtotime( $start_datetime ) );
			$end_time   = $end_datetime ? gmdate( 'H:i:s', strtotime( $end_datetime ) ) : '00:00:00';
			$all_day    = ( '00:00:00' === $start_time && '00:00:00' === $end_time );
		}

		// Get excerpt or truncated content.
		$description = '';
		if ( ! empty( $row->post_excerpt ) ) {
			$description = $row->post_excerpt;
		} elseif ( ! empty( $row->post_content ) ) {
			$description = wp_trim_words( wp_strip_all_tags( $row->post_content ), 30 );
		}

		// Generate unique ID for cross-site reference.
		// Include occurrence_id to make each occurrence unique.
		$site_host = wp_parse_url( get_site_url(), PHP_URL_HOST );
		$uid       = 'fair_event_' . $row->event_id . '_' . $row->occurrence_id . '@' . $site_host;

		return array(
			'uid'         => $uid,
			'title'       => $row->post_title,
			'description' => $description,
			'start'       => $start_datetime ? gmdate( 'c', strtotime( $start_datetime ) ) : '',
			'end'         => $end_datetime ? gmdate( 'c', strtotime( $end_datetime ) ) : '',
			'all_day'     => $all_day,
			'url'         => get_permalink( $row->event_id ),
		);
	}

	/**
	 * Format a single event for JSON response (legacy method)
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
