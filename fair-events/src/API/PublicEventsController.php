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
use FairEvents\Helpers\DateHelper;
use FairEvents\Services\EventFeedProvider;
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
						'context'    => array(
							'description' => __( 'Request context. Use "edit" to include events linked to non-published posts (requires edit_posts capability).', 'fair-events' ),
							'type'        => 'string',
							'default'     => 'view',
							'enum'        => array( 'view', 'edit' ),
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
		$context    = $request->get_param( 'context' );

		// Only allow edit context for users with edit_posts capability.
		$include_all_statuses = ( 'edit' === $context && current_user_can( 'edit_posts' ) );

		$provider    = new EventFeedProvider();
		$occurrences = $provider->get_occurrences(
			$this->range_start( $start_date ),
			$this->range_end( $end_date ),
			array(
				'categories'           => $this->resolve_category_ids( $categories ),
				'include_all_statuses' => $include_all_statuses,
			)
		);

		return $this->build_response( $this->paginate( $occurrences, $per_page, $page ), $per_page, $page );
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

		$provider    = new EventFeedProvider();
		$occurrences = $provider->get_occurrences(
			$this->range_start( $start_date ),
			$this->range_end( $end_date ),
			array( 'event_source_slugs' => array( $slug ) )
		);

		return $this->build_response( $this->paginate( $occurrences, $per_page, $page ), $per_page, $page );
	}

	/**
	 * Convert an optional Y-m-d start_date param into a naive site-local
	 * range-start datetime, defaulting to an open lower bound.
	 *
	 * @param string|null $start_date Y-m-d date, or null/empty for no lower bound.
	 * @return string Naive 'Y-m-d H:i:s' site-local datetime.
	 */
	private function range_start( $start_date ) {
		return $start_date ? $start_date . ' 00:00:00' : '0000-01-01 00:00:00';
	}

	/**
	 * Convert an optional Y-m-d end_date param into a naive site-local
	 * range-end datetime, defaulting to an open upper bound.
	 *
	 * @param string|null $end_date Y-m-d date, or null/empty for no upper bound.
	 * @return string Naive 'Y-m-d H:i:s' site-local datetime.
	 */
	private function range_end( $end_date ) {
		return $end_date ? $end_date . ' 23:59:59' : '9999-12-31 23:59:59';
	}

	/**
	 * Resolve a comma-separated list of category slugs into term IDs.
	 *
	 * @param string|null $categories Comma-separated category slugs.
	 * @return int[] Category term IDs.
	 */
	private function resolve_category_ids( $categories ) {
		$category_ids = array();

		if ( empty( $categories ) ) {
			return $category_ids;
		}

		$category_slugs = array_map( 'trim', explode( ',', $categories ) );
		foreach ( $category_slugs as $slug ) {
			$term = get_term_by( 'slug', $slug, 'category' );
			if ( $term ) {
				$category_ids[] = $term->term_id;
			}
		}

		return $category_ids;
	}

	/**
	 * Slice a sorted occurrence list to the requested page and format each
	 * DTO for the public JSON response.
	 *
	 * @param array[] $occurrences Flat, sorted occurrence DTOs from the provider.
	 * @param int     $per_page    Number of events per page.
	 * @param int     $page        Page number.
	 * @return array[] Formatted events for this page.
	 */
	private function paginate( array $occurrences, $per_page, $page ) {
		$offset     = ( $page - 1 ) * $per_page;
		$page_slice = array_slice( $occurrences, $offset, $per_page );

		return array_map( array( $this, 'format_for_response' ), $page_slice );
	}

	/**
	 * Format a provider occurrence DTO for the public JSON response.
	 *
	 * @param array $occurrence Occurrence DTO from EventFeedProvider.
	 * @return array Formatted event data.
	 */
	private function format_for_response( array $occurrence ) {
		return array(
			'uid'             => $occurrence['uid'],
			'event_date_id'   => $occurrence['event_date_id'],
			'occurrence_type' => $occurrence['occurrence_type'],
			'title'           => $occurrence['title'],
			'description'     => $occurrence['description'],
			'start'           => ! empty( $occurrence['start'] ) ? DateHelper::local_to_iso8601( $occurrence['start'] ) : '',
			'end'             => ! empty( $occurrence['end'] ) ? DateHelper::local_to_iso8601( $occurrence['end'] ) : '',
			'all_day'         => $occurrence['all_day'],
			'url'             => $occurrence['url'] ?? '',
			'categories'      => $occurrence['categories'],
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
				'timezone'  => wp_timezone_string(),
				'total'     => count( $events ),
				'page'      => $page,
				'per_page'  => $per_page,
			),
			'events' => $events,
		);

		return new WP_REST_Response( $response_data, 200 );
	}
}
