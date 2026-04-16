<?php
/**
 * REST API Controller for Event Dates
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairEvents\Services\RecurrenceService;
use FairEvents\Database\EventPhotoRepository;
use FairEvents\Database\EventSourceRepository;
use FairEvents\Database\PhotoLikeRepository;
use FairEvents\Frontend\EventGalleryPage;
use FairEvents\Helpers\FairEventsApiParser;
use FairEvents\Helpers\ICalParser;
use FairEvents\Settings\Settings;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles event dates REST API endpoints
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventDatesController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Register the routes for event dates
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET, POST /fair-events/v1/event-dates.
		register_rest_route(
			$this->namespace,
			'/event-dates',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => $this->get_create_update_args(),
				),
			)
		);

		// GET, PUT, DELETE /fair-events/v1/event-dates/{id}.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the event date.', 'fair-events' ),
							'type'        => 'integer',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => $this->get_update_args(),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the event date.', 'fair-events' ),
							'type'        => 'integer',
						),
					),
				),
			)
		);

		// POST /fair-events/v1/event-dates/{id}/create-post - Create WP post and link it.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/create-post',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_post' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'id'          => array(
							'description' => __( 'Event date ID to link to.', 'fair-events' ),
							'type'        => 'integer',
						),
						'post_type'   => array(
							'description' => __( 'Post type for the new post.', 'fair-events' ),
							'type'        => 'string',
							'default'     => 'fair_event',
						),
						'post_status' => array(
							'description' => __( 'Status for the new post.', 'fair-events' ),
							'type'        => 'string',
							'default'     => 'draft',
						),
					),
				),
			)
		);

		// POST /fair-events/v1/event-dates/{id}/link-post - Link an existing post.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/link-post',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'link_post' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'id'      => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
						),
						'post_id' => array(
							'description' => __( 'Post ID to link.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);

		// DELETE /fair-events/v1/event-dates/{id}/link-post - Unlink a post.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/link-post',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'unlink_post' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'id'      => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
						),
						'post_id' => array(
							'description' => __( 'Post ID to unlink.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);

		// POST /fair-events/v1/event-dates/{id}/toggle-exdate - Toggle an excluded date on a master event.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/toggle-exdate',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'toggle_exdate' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'id'   => array(
							'description' => __( 'Master event date ID.', 'fair-events' ),
							'type'        => 'integer',
						),
						'date' => array(
							'description'       => __( 'Date to toggle (Y-m-d format).', 'fair-events' ),
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// GET /fair-events/v1/event-dates/batch - Batch lookup by IDs.
		register_rest_route(
			$this->namespace,
			'/event-dates/batch',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_batch' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'ids' => array(
							'description'       => __( 'Comma-separated list of event date IDs.', 'fair-events' ),
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// GET /fair-events/v1/event-dates/all - Paginated list of all event dates.
		register_rest_route(
			$this->namespace,
			'/event-dates/all',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_all_items' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'page'            => array(
							'description' => __( 'Current page of the collection.', 'fair-events' ),
							'type'        => 'integer',
							'default'     => 1,
							'minimum'     => 1,
						),
						'per_page'        => array(
							'description' => __( 'Maximum number of items per page.', 'fair-events' ),
							'type'        => 'integer',
							'default'     => 25,
							'minimum'     => 1,
							'maximum'     => 100,
						),
						'orderby'         => array(
							'description' => __( 'Sort collection by field.', 'fair-events' ),
							'type'        => 'string',
							'default'     => 'start_datetime',
							'enum'        => array( 'id', 'title', 'start_datetime', 'link_type', 'occurrence_type' ),
						),
						'order'           => array(
							'description' => __( 'Order sort attribute ascending or descending.', 'fair-events' ),
							'type'        => 'string',
							'default'     => 'desc',
							'enum'        => array( 'asc', 'desc' ),
						),
						'search'          => array(
							'description'       => __( 'Limit results to those matching a string.', 'fair-events' ),
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'link_type'       => array(
							'description' => __( 'Filter by link type.', 'fair-events' ),
							'type'        => 'string',
							'enum'        => array( 'post', 'external', 'none' ),
						),
						'occurrence_type' => array(
							'description' => __( 'Filter by occurrence type.', 'fair-events' ),
							'type'        => 'string',
							'enum'        => array( 'single', 'master', 'generated' ),
						),
					),
				),
			)
		);
	}

	/**
	 * Get arguments for create/update endpoints
	 *
	 * @return array Arguments definition.
	 */
	private function get_create_update_args() {
		return array(
			'title'          => array(
				'description'       => __( 'Event title.', 'fair-events' ),
				'type'              => 'string',
				'required'          => true,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'start_datetime' => array(
				'description'       => __( 'Start date/time (Y-m-d H:i:s format).', 'fair-events' ),
				'type'              => 'string',
				'required'          => true,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'end_datetime'   => array(
				'description'       => __( 'End date/time (Y-m-d H:i:s format).', 'fair-events' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'all_day'        => array(
				'description' => __( 'Whether this is an all-day event.', 'fair-events' ),
				'type'        => 'boolean',
				'required'    => false,
				'default'     => false,
			),
			'venue_id'       => array(
				'description' => __( 'Venue ID.', 'fair-events' ),
				'type'        => array( 'integer', 'null' ),
				'required'    => false,
			),
			'link_type'      => array(
				'description' => __( 'Link type (post, external, none).', 'fair-events' ),
				'type'        => 'string',
				'required'    => false,
				'default'     => 'none',
				'enum'        => array( 'post', 'external', 'none' ),
			),
			'external_url'   => array(
				'description'       => __( 'External URL for the event.', 'fair-events' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'esc_url_raw',
			),
			'theme_image_id' => array(
				'description' => __( 'Theme image attachment ID.', 'fair-events' ),
				'type'        => array( 'integer', 'null' ),
				'required'    => false,
			),
			'signup_price'   => array(
				'description' => __( 'Signup price (null = free).', 'fair-events' ),
				'type'        => array( 'number', 'null' ),
				'required'    => false,
			),
			'event_id'       => array(
				'description' => __( 'Linked post ID.', 'fair-events' ),
				'type'        => array( 'integer', 'null' ),
				'required'    => false,
			),
			'rrule'          => array(
				'description'       => __( 'Recurrence rule in RRULE format.', 'fair-events' ),
				'type'              => array( 'string', 'null' ),
				'required'          => false,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'categories'     => array(
				'description' => __( 'Category term IDs.', 'fair-events' ),
				'type'        => 'array',
				'required'    => false,
				'items'       => array( 'type' => 'integer' ),
			),
		);
	}

	/**
	 * Get args for update requests (all fields optional)
	 *
	 * @return array Update endpoint arguments.
	 */
	private function get_update_args() {
		$args = $this->get_create_update_args();

		// For updates, title and start_datetime are optional.
		$args['title']['required']          = false;
		$args['start_datetime']['required'] = false;

		return $args;
	}

	/**
	 * Create a standalone event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_item( $request ) {
		$title          = $request->get_param( 'title' );
		$start_datetime = $request->get_param( 'start_datetime' );
		$end_datetime   = $request->get_param( 'end_datetime' );
		$all_day        = $request->get_param( 'all_day' );
		$venue_id       = $request->get_param( 'venue_id' );
		$link_type      = $request->get_param( 'link_type' ) ?? 'none';
		$external_url   = $request->get_param( 'external_url' );

		if ( empty( $title ) ) {
			return new WP_Error(
				'rest_invalid_title',
				__( 'Event title is required.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		if ( empty( $start_datetime ) ) {
			return new WP_Error(
				'rest_invalid_start',
				__( 'Start date/time is required.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$data = array(
			'title'          => $title,
			'start_datetime' => $start_datetime,
			'end_datetime'   => $end_datetime,
			'all_day'        => $all_day,
			'link_type'      => $link_type,
			'external_url'   => $external_url,
		);

		$id = EventDates::create_standalone( $data );

		if ( ! $id ) {
			return new WP_Error(
				'rest_event_date_creation_failed',
				__( 'Failed to create event date.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		// Set venue if provided.
		if ( $venue_id ) {
			EventDates::update_by_id( $id, array( 'venue_id' => $venue_id ) );
		}

		// Regenerate recurrence occurrences if rrule is provided.
		$rrule = $request->get_param( 'rrule' );
		if ( ! empty( $rrule ) ) {
			EventDates::update_by_id( $id, array( 'rrule' => $rrule ) );
			RecurrenceService::regenerate_standalone_occurrences( $id, $rrule );
		}

		// Set categories for standalone event date.
		$categories = $request->get_param( 'categories' );
		if ( is_array( $categories ) ) {
			$this->set_standalone_categories( $id, $categories );

			// Propagate categories to generated occurrences.
			if ( ! empty( $rrule ) ) {
				$generated = EventDates::get_generated_by_master_id( $id );
				foreach ( $generated as $occ ) {
					$this->set_standalone_categories( $occ->id, $categories );
				}
			}
		}

		$event_date = EventDates::get_by_id( $id );

		return new WP_REST_Response( $this->prepare_event_date( $event_date ), 201 );
	}

	/**
	 * Get event dates
	 *
	 * By default returns unlinked events. Pass include_linked=true to include all events.
	 * Supports search, per_page, and include_sources parameters.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_items( $request ) {
		$include_linked  = $request->get_param( 'include_linked' );
		$search          = $request->get_param( 'search' );
		$per_page        = $request->get_param( 'per_page' );
		$include_sources = $request->get_param( 'include_sources' );

		// Get local event dates.
		if ( $search ) {
			$event_dates = $this->search_event_dates( $search, $per_page ? (int) $per_page * 2 : 50 );
		} elseif ( $include_linked ) {
			$event_dates = $this->get_all_master_event_dates();
		} else {
			$event_dates = EventDates::get_unlinked();
		}

		$items = array();
		foreach ( $event_dates as $event_date ) {
			$items[] = $this->prepare_event_date( $event_date );
		}

		// Include events from enabled event sources.
		if ( $include_sources && $search ) {
			// Collect local display_urls for deduplication.
			$local_urls = array();
			foreach ( $items as $item ) {
				if ( ! empty( $item['display_url'] ) ) {
					$local_urls[ $item['display_url'] ] = true;
				}
			}

			$source_events = $this->search_source_events( $search, $local_urls );
			$items         = array_merge( $items, $source_events );
		}

		// Apply per_page limit.
		if ( $per_page && count( $items ) > (int) $per_page ) {
			$items = array_slice( $items, 0, (int) $per_page );
		}

		return new WP_REST_Response( $items, 200 );
	}

	/**
	 * Search event dates by title
	 *
	 * @param string $search Search term.
	 * @param int    $limit  Maximum number of results.
	 * @return EventDates[] Array of matching EventDates objects.
	 */
	private function search_event_dates( $search, $limit ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE title LIKE %s AND occurrence_type IN ('single', 'master') ORDER BY start_datetime DESC LIMIT %d",
				$table_name,
				'%' . $wpdb->esc_like( $search ) . '%',
				$limit
			)
		);

		if ( ! $results ) {
			return array();
		}

		$dates = array();
		foreach ( $results as $result ) {
			$dates[] = EventDates::get_by_id( (int) $result->id );
		}

		return array_filter( $dates );
	}

	/**
	 * Search events from all enabled event sources
	 *
	 * @param string $search    Search term.
	 * @param array  $local_urls URLs already present in local results for deduplication.
	 * @return array Array of event data matching the typeahead format.
	 */
	private function search_source_events( $search, $local_urls ) {
		$repository = new EventSourceRepository();
		$sources    = $repository->get_all( true );
		$results    = array();

		foreach ( $sources as $source ) {
			foreach ( $source['data_sources'] as $data_source ) {
				// Skip categories type — local search already covers these.
				if ( 'categories' === $data_source['source_type'] ) {
					continue;
				}

				$events = $this->fetch_data_source_events( $source['id'], $data_source );

				foreach ( $events as $event ) {
					$title = $event['summary'] ?? '';
					$url   = $event['url'] ?? '';

					// Filter by search term and require a URL.
					if ( empty( $url ) || false === stripos( $title, $search ) ) {
						continue;
					}

					// Skip duplicates already in local results.
					if ( isset( $local_urls[ $url ] ) ) {
						continue;
					}

					$local_urls[ $url ] = true;

					$results[] = array(
						'id'             => 'source_' . ( $event['uid'] ?? md5( $url ) ),
						'title'          => $title,
						'start_datetime' => $event['start'] ?? '',
						'display_url'    => $url,
					);
				}
			}
		}

		return $results;
	}

	/**
	 * Fetch events from a single data source with transient caching
	 *
	 * @param int   $source_id   Event source ID.
	 * @param array $data_source Data source configuration.
	 * @return array Array of parsed events.
	 */
	private function fetch_data_source_events( $source_id, $data_source ) {
		$cache_key = 'fair_events_src_' . $source_id . '_' . md5( wp_json_encode( $data_source ) );
		$cached    = get_transient( $cache_key );

		if ( false !== $cached ) {
			return $cached;
		}

		$events = array();

		if ( 'ical_url' === $data_source['source_type'] ) {
			$url = $data_source['config']['url'] ?? '';
			if ( ! empty( $url ) ) {
				$events = ICalParser::fetch_and_parse( $url );
			}
		} elseif ( 'fair_events_api' === $data_source['source_type'] ) {
			$url = $data_source['config']['url'] ?? '';
			if ( ! empty( $url ) ) {
				$events = FairEventsApiParser::fetch_and_parse( $url );
			}
		}

		set_transient( $cache_key, $events, HOUR_IN_SECONDS );

		return $events;
	}

	/**
	 * Get all master/single event dates (including linked ones)
	 *
	 * @return EventDates[] Array of EventDates objects.
	 */
	private function get_all_master_event_dates() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE occurrence_type IN ('single', 'master') ORDER BY start_datetime DESC",
				$table_name
			)
		);

		if ( ! $results ) {
			return array();
		}

		$dates = array();
		foreach ( $results as $result ) {
			$dates[] = EventDates::get_by_id( (int) $result->id );
		}

		return array_filter( $dates );
	}

	/**
	 * Get single event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_item( $request ) {
		$id         = (int) $request->get_param( 'id' );
		$event_date = EventDates::get_by_id( $id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $this->prepare_event_date( $event_date ), 200 );
	}

	/**
	 * Get multiple event dates by IDs (batch lookup)
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_batch( $request ) {
		$ids_param = $request->get_param( 'ids' );
		$ids       = array_filter( array_map( 'intval', explode( ',', $ids_param ) ) );

		if ( empty( $ids ) ) {
			return new WP_REST_Response( array(), 200 );
		}

		$results = array();
		foreach ( $ids as $id ) {
			$event_date = EventDates::get_by_id( $id );
			if ( $event_date ) {
				$results[] = array(
					'id'             => (int) $event_date->id,
					'title'          => $event_date->get_display_title(),
					'display_url'    => $event_date->get_display_url(),
					'start_datetime' => $event_date->start_datetime,
				);
			}
		}

		return new WP_REST_Response( $results, 200 );
	}

	/**
	 * Update event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function update_item( $request ) {
		$id       = (int) $request->get_param( 'id' );
		$existing = EventDates::get_by_id( $id );

		if ( ! $existing ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$update_data = array();

		$title = $request->get_param( 'title' );
		if ( null !== $title ) {
			$update_data['title'] = $title;
		}

		$start_datetime = $request->get_param( 'start_datetime' );
		if ( null !== $start_datetime ) {
			$update_data['start_datetime'] = $start_datetime;
		}

		$end_datetime = $request->get_param( 'end_datetime' );
		if ( null !== $end_datetime ) {
			$update_data['end_datetime'] = $end_datetime;
		}

		$all_day = $request->get_param( 'all_day' );
		if ( null !== $all_day ) {
			$update_data['all_day'] = $all_day ? 1 : 0;
		}

		if ( $request->has_param( 'venue_id' ) ) {
			$update_data['venue_id'] = $request->get_param( 'venue_id' );
		}

		$link_type = $request->get_param( 'link_type' );
		if ( null !== $link_type ) {
			$update_data['link_type'] = $link_type;
		}

		$external_url = $request->get_param( 'external_url' );
		if ( null !== $external_url ) {
			$update_data['external_url'] = $external_url;
		}

		$theme_image_id = $request->get_param( 'theme_image_id' );
		if ( null !== $theme_image_id ) {
			$update_data['theme_image_id'] = $theme_image_id ? absint( $theme_image_id ) : null;
		}

		if ( $request->has_param( 'signup_price' ) ) {
			$raw_signup_price            = $request->get_param( 'signup_price' );
			$update_data['signup_price'] = ( null === $raw_signup_price || '' === $raw_signup_price )
				? null
				: (float) $raw_signup_price;
		}

		$event_id = $request->get_param( 'event_id' );
		if ( null !== $event_id ) {
			$new_event_id            = $event_id ? absint( $event_id ) : null;
			$update_data['event_id'] = $new_event_id;

			// Keep junction table in sync.
			if ( $new_event_id ) {
				EventDates::add_linked_post( $id, $new_event_id );
			}
			if ( $existing->event_id && ( ! $new_event_id || $new_event_id !== $existing->event_id ) ) {
				EventDates::remove_linked_post( $id, $existing->event_id );
			}
		}

		$rrule = $request->get_param( 'rrule' );
		if ( null !== $rrule ) {
			$update_data['rrule'] = $rrule ?: null;
		}

		if ( ! empty( $update_data ) ) {
			$success = EventDates::update_by_id( $id, $update_data );

			if ( ! $success ) {
				return new WP_Error(
					'rest_event_date_update_failed',
					__( 'Failed to update event date.', 'fair-events' ),
					array( 'status' => 500 )
				);
			}

			// Determine the effective event_id after update.
			$effective_event_id = isset( $update_data['event_id'] ) ? $update_data['event_id'] : $existing->event_id;

			// Sync title to linked post when title changes.
			if ( $effective_event_id && isset( $update_data['title'] ) ) {
				wp_update_post(
					array(
						'ID'         => $effective_event_id,
						'post_title' => $update_data['title'],
					)
				);
			}

			// Regenerate recurrence occurrences when rrule or dates change.
			$rrule_changed              = isset( $update_data['rrule'] );
			$dates_changed_on_recurring = $dates_changed && ( $existing->occurrence_type === 'master' || $rrule_changed );

			if ( $rrule_changed || $dates_changed_on_recurring ) {
				$effective_rrule = $update_data['rrule'] ?? $existing->rrule;

				if ( $effective_event_id ) {
					RecurrenceService::regenerate_event_occurrences( $effective_event_id, $effective_rrule );
				} else {
					RecurrenceService::regenerate_standalone_occurrences( $id, $effective_rrule );
				}
			}

			// When linking a standalone event to a post, copy categories to post taxonomy.
			if ( $newly_linked ) {
				$standalone_cat_ids = $this->get_standalone_category_ids( $id );
				if ( ! empty( $standalone_cat_ids ) ) {
					wp_set_post_terms( $effective_event_id, $standalone_cat_ids, 'category' );
					$this->set_standalone_categories( $id, array() );
				}
			}

			// When unlinking a post-linked event, copy categories to junction table.
			$newly_unlinked = isset( $update_data['event_id'] ) && ! $update_data['event_id'] && $existing->event_id;
			if ( $newly_unlinked ) {
				$terms   = wp_get_post_terms( $existing->event_id, 'category' );
				$cat_ids = array();
				if ( ! is_wp_error( $terms ) ) {
					$cat_ids = wp_list_pluck( $terms, 'term_id' );
				}
				if ( ! empty( $cat_ids ) ) {
					$this->set_standalone_categories( $id, $cat_ids );
				}
			}
		}

		// Handle categories parameter.
		$categories = $request->get_param( 'categories' );
		if ( is_array( $categories ) ) {
			// Re-fetch to get latest state after potential link changes.
			$current = EventDates::get_by_id( $id );
			if ( $current->event_id ) {
				wp_set_post_terms( $current->event_id, $categories, 'category' );
			} else {
				$this->set_standalone_categories( $id, $categories );
			}
		}

		// Propagate categories to generated occurrences for standalone master events.
		$current_for_propagation = EventDates::get_by_id( $id );
		if ( 'master' === $current_for_propagation->occurrence_type && ! $current_for_propagation->event_id ) {
			$master_cat_ids = $this->get_standalone_category_ids( $id );
			$generated      = EventDates::get_generated_by_master_id( $id );
			foreach ( $generated as $occ ) {
				$this->set_standalone_categories( $occ->id, $master_cat_ids );
			}
		}

		$event_date = EventDates::get_by_id( $id );

		return new WP_REST_Response( $this->prepare_event_date( $event_date ), 200 );
	}

	/**
	 * Delete event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function delete_item( $request ) {
		$id       = (int) $request->get_param( 'id' );
		$existing = EventDates::get_by_id( $id );

		if ( ! $existing ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$success = EventDates::delete_by_id( $id );

		if ( ! $success ) {
			return new WP_Error(
				'rest_event_date_delete_failed',
				__( 'Failed to delete event date.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted'    => true,
				'event_date' => $this->prepare_event_date( $existing ),
			),
			200
		);
	}

	/**
	 * Create a WordPress post and link it to an event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_post( $request ) {
		$id          = (int) $request->get_param( 'id' );
		$post_type   = $request->get_param( 'post_type' ) ?? 'fair_event';
		$post_status = $request->get_param( 'post_status' ) ?? 'draft';

		$event_date = EventDates::get_by_id( $id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Validate post type is enabled.
		$enabled_post_types = Settings::get_enabled_post_types();
		if ( ! in_array( $post_type, $enabled_post_types, true ) ) {
			return new WP_Error(
				'rest_invalid_post_type',
				__( 'The specified post type is not enabled.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// Create the WordPress post.
		$post_id = wp_insert_post(
			array(
				'post_title'  => $event_date->title ?? __( 'Untitled Event', 'fair-events' ),
				'post_type'   => $post_type,
				'post_status' => $post_status,
			),
			true
		);

		if ( is_wp_error( $post_id ) ) {
			return new WP_Error(
				'rest_post_creation_failed',
				$post_id->get_error_message(),
				array( 'status' => 500 )
			);
		}

		// Link the event date to the post.
		EventDates::update_by_id(
			$id,
			array(
				'event_id'  => $post_id,
				'link_type' => 'post',
			)
		);

		// Add to junction table.
		EventDates::add_linked_post( $id, $post_id );

		// Copy standalone categories to the new post.
		$standalone_cat_ids = $this->get_standalone_category_ids( $id );
		if ( ! empty( $standalone_cat_ids ) ) {
			wp_set_post_terms( $post_id, $standalone_cat_ids, 'category' );
			$this->set_standalone_categories( $id, array() );
		}

		$edit_url = get_edit_post_link( $post_id, 'raw' );

		return new WP_REST_Response(
			array(
				'post_id'  => $post_id,
				'edit_url' => $edit_url,
			),
			201
		);
	}

	/**
	 * Link an existing post to an event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function link_post( $request ) {
		$id      = (int) $request->get_param( 'id' );
		$post_id = (int) $request->get_param( 'post_id' );

		$event_date = EventDates::get_by_id( $id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$post = get_post( $post_id );
		if ( ! $post ) {
			return new WP_Error(
				'rest_post_not_found',
				__( 'Post not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Generated occurrences store links on the master event date.
		$link_event_date = $event_date;
		if ( 'generated' === $event_date->occurrence_type && $event_date->master_id ) {
			$master = EventDates::get_by_id( $event_date->master_id );
			if ( $master ) {
				$link_event_date = $master;
			}
		}

		// Check if post is already linked to a different event.
		$existing = EventDates::get_by_event_id( $post_id );
		if ( $existing && (int) $existing->id !== $link_event_date->id ) {
			return new WP_Error(
				'rest_post_already_linked',
				__( 'This post is already linked to another event.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		// Add to junction table.
		EventDates::add_linked_post( $link_event_date->id, $post_id );

		// If this is the first linked post (no primary set), set as primary.
		if ( ! $link_event_date->event_id ) {
			EventDates::update_by_id(
				$link_event_date->id,
				array(
					'event_id'  => $post_id,
					'link_type' => 'post',
				)
			);
		}

		$event_date = EventDates::get_by_id( $id );

		return new WP_REST_Response( $this->prepare_event_date( $event_date ), 200 );
	}

	/**
	 * Unlink a post from an event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function unlink_post( $request ) {
		$id      = (int) $request->get_param( 'id' );
		$post_id = (int) $request->get_param( 'post_id' );

		$event_date = EventDates::get_by_id( $id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Generated occurrences store links on the master event date.
		$link_event_date = $event_date;
		if ( 'generated' === $event_date->occurrence_type && $event_date->master_id ) {
			$master = EventDates::get_by_id( $event_date->master_id );
			if ( $master ) {
				$link_event_date = $master;
			}
		}

		// Remove from junction table.
		EventDates::remove_linked_post( $link_event_date->id, $post_id );

		// If this was the primary post, promote next linked post or clear the link.
		if ( (int) $link_event_date->event_id === $post_id ) {
			$remaining_post_ids = EventDates::get_linked_post_ids( $link_event_date->id );

			if ( ! empty( $remaining_post_ids ) ) {
				// Promote first remaining post to primary.
				$new_primary = $remaining_post_ids[0];
				EventDates::update_by_id( $link_event_date->id, array( 'event_id' => $new_primary ) );
			} else {
				// No more linked posts, clear event_id and set link_type to none.
				EventDates::update_by_id(
					$link_event_date->id,
					array(
						'event_id'  => null,
						'link_type' => 'none',
					)
				);
			}
		}

		// Return the originally requested event date (occurrence, not master).
		$event_date = EventDates::get_by_id( $id );

		return new WP_REST_Response( $this->prepare_event_date( $event_date ), 200 );
	}

	/**
	 * Toggle an excluded date on a master event
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function toggle_exdate( $request ) {
		$id   = (int) $request->get_param( 'id' );
		$date = $request->get_param( 'date' );

		$event_date = EventDates::get_by_id( $id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		if ( 'master' !== $event_date->occurrence_type ) {
			return new WP_Error(
				'rest_not_master_event',
				__( 'Exdates can only be set on master events.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// Don't allow excluding the master's own date.
		$master_date = ( new \DateTime( $event_date->start_datetime ) )->format( 'Y-m-d' );
		if ( $date === $master_date ) {
			return new WP_Error(
				'rest_cannot_exclude_master',
				__( 'Cannot exclude the master event date.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// Parse current exdates.
		$exdates = RecurrenceService::parse_exdates( $event_date->exdates );

		// Toggle: add if not present, remove if present.
		$key = array_search( $date, $exdates, true );
		if ( false !== $key ) {
			unset( $exdates[ $key ] );
			$exdates = array_values( $exdates );
		} else {
			$exdates[] = $date;
		}

		// Clean stale exdates.
		$exdates = RecurrenceService::clean_stale_exdates(
			$event_date->start_datetime,
			$event_date->end_datetime,
			$event_date->rrule,
			$exdates
		);

		// Save exdates.
		$exdates_string = ! empty( $exdates ) ? implode( ',', $exdates ) : null;
		EventDates::update_by_id( $id, array( 'exdates' => $exdates_string ) );

		// Regenerate occurrences.
		if ( $event_date->event_id ) {
			RecurrenceService::regenerate_event_occurrences( $event_date->event_id );
		} else {
			RecurrenceService::regenerate_standalone_occurrences( $id );
		}

		// Return updated event date.
		$updated = EventDates::get_by_id( $id );

		return new WP_REST_Response( $this->prepare_event_date( $updated ), 200 );
	}

	/**
	 * Get paginated list of all event dates
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_all_items( $request ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';
		$page       = $request->get_param( 'page' );
		$per_page   = $request->get_param( 'per_page' );
		$orderby    = $request->get_param( 'orderby' );
		$order      = strtoupper( $request->get_param( 'order' ) );

		// Build WHERE clauses.
		$where_clauses = array();
		$where_values  = array();

		$search = $request->get_param( 'search' );
		if ( ! empty( $search ) ) {
			$where_clauses[] = 'title LIKE %s';
			$where_values[]  = '%' . $wpdb->esc_like( $search ) . '%';
		}

		$link_type = $request->get_param( 'link_type' );
		if ( ! empty( $link_type ) ) {
			$where_clauses[] = 'link_type = %s';
			$where_values[]  = $link_type;
		}

		$occurrence_type = $request->get_param( 'occurrence_type' );
		if ( ! empty( $occurrence_type ) ) {
			$where_clauses[] = 'occurrence_type = %s';
			$where_values[]  = $occurrence_type;
		}

		$where_sql = '';
		if ( ! empty( $where_clauses ) ) {
			$where_sql = 'WHERE ' . implode( ' AND ', $where_clauses );
		}

		// Whitelist orderby to prevent SQL injection.
		$allowed_orderby = array( 'id', 'title', 'start_datetime', 'link_type', 'occurrence_type' );
		if ( ! in_array( $orderby, $allowed_orderby, true ) ) {
			$orderby = 'start_datetime';
		}
		if ( 'ASC' !== $order ) {
			$order = 'DESC';
		}

		// Count total items.
		if ( ! empty( $where_values ) ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$total = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM %i $where_sql", $table_name, ...$where_values ) );
		} else {
			$total = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table_name ) );
		}

		$total_pages = (int) ceil( $total / $per_page );
		$offset      = ( $page - 1 ) * $per_page;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$order_sql = "ORDER BY `$orderby` $order LIMIT %d OFFSET %d";

		if ( ! empty( $where_values ) ) {
			$select_args = array_merge( array( $table_name ), $where_values, array( $per_page, $offset ) );
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$results = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM %i $where_sql $order_sql", ...$select_args ) );
		} else {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$results = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM %i $order_sql", $table_name, $per_page, $offset ) );
		}

		$items = array();
		foreach ( $results as $result ) {
			$items[] = $this->prepare_event_date_summary( $result );
		}

		$response = new WP_REST_Response( $items, 200 );
		$response->header( 'X-WP-Total', $total );
		$response->header( 'X-WP-TotalPages', $total_pages );

		return $response;
	}

	/**
	 * Prepare a lightweight event date summary for list view
	 *
	 * @param object $result Database row object.
	 * @return array Summary data.
	 */
	private function prepare_event_date_summary( $result ) {
		$data = array(
			'id'              => (int) $result->id,
			'event_id'        => $result->event_id ? (int) $result->event_id : null,
			'title'           => $result->title,
			'start_datetime'  => $result->start_datetime,
			'end_datetime'    => $result->end_datetime,
			'all_day'         => (bool) $result->all_day,
			'occurrence_type' => $result->occurrence_type,
			'master_id'       => $result->master_id ? (int) $result->master_id : null,
			'link_type'       => $result->link_type,
			'external_url'    => $result->external_url,
			'venue_id'        => $result->venue_id ? (int) $result->venue_id : null,
		);

		// Add display_url.
		$event_date = EventDates::get_by_id( (int) $result->id );
		if ( $event_date ) {
			$data['display_url'] = $event_date->get_display_url();
			$data['categories']  = $this->get_event_date_categories( $event_date );
		} else {
			$data['display_url'] = null;
			$data['categories']  = array();
		}

		// Add post info if linked.
		if ( $result->event_id ) {
			$post = get_post( (int) $result->event_id );
			if ( $post ) {
				$data['post'] = array(
					'id'       => $post->ID,
					'title'    => $post->post_title,
					'status'   => $post->post_status,
					'edit_url' => get_edit_post_link( $post->ID, 'raw' ),
				);
			}
		}

		return $data;
	}

	/**
	 * Prepare event date data for response
	 *
	 * @param EventDates $event_date Event date object.
	 * @return array Prepared event date data.
	 */
	private function prepare_event_date( $event_date ) {
		$data = array(
			'id'              => $event_date->id,
			'event_id'        => $event_date->event_id,
			'title'           => $event_date->title,
			'start_datetime'  => $event_date->start_datetime,
			'end_datetime'    => $event_date->end_datetime,
			'all_day'         => $event_date->all_day,
			'occurrence_type' => $event_date->occurrence_type,
			'master_id'       => $event_date->master_id,
			'venue_id'        => $event_date->venue_id,
			'link_type'       => $event_date->link_type,
			'external_url'    => $event_date->external_url,
			'display_url'     => $event_date->get_display_url(),
			'rrule'           => $event_date->rrule,
			'theme_image_id'  => $event_date->theme_image_id ? (int) $event_date->theme_image_id : null,
			'theme_image_url' => $event_date->theme_image_id
				? wp_get_attachment_image_url( $event_date->theme_image_id, 'full' )
				: null,
			'signup_price'    => null !== $event_date->signup_price ? (float) $event_date->signup_price : null,
		);

		// Add exdates for master events.
		if ( 'master' === $event_date->occurrence_type ) {
			$data['exdates'] = $event_date->exdates
				? array_values( array_filter( array_map( 'trim', explode( ',', $event_date->exdates ) ) ) )
				: array();
		}

		// Add master event info for generated occurrences.
		if ( 'generated' === $event_date->occurrence_type && $event_date->master_id ) {
			$master = EventDates::get_by_id( $event_date->master_id );
			if ( $master ) {
				$data['master'] = array(
					'id'             => $master->id,
					'title'          => $master->title,
					'start_datetime' => $master->start_datetime,
				);
			}
		}

		// Add generated occurrences for master events.
		if ( 'master' === $event_date->occurrence_type ) {
			$generated                     = EventDates::get_generated_by_master_id( $event_date->id );
			$data['generated_occurrences'] = array_map(
				function ( $occ ) {
					return array(
						'id'             => $occ->id,
						'start_datetime' => $occ->start_datetime,
						'title'          => $occ->title,
					);
				},
				$generated
			);
		}

		// Add categories.
		$data['categories'] = $this->get_event_date_categories( $event_date );

		// Add image exports.
		$data['image_exports'] = ImageExportController::get_exports_for_event_date( $event_date->id );

		// Add all linked posts from junction table.
		// Generated occurrences inherit linked posts from their master event date.
		$link_source = $event_date;
		if ( 'generated' === $event_date->occurrence_type && $event_date->master_id ) {
			$master = EventDates::get_by_id( $event_date->master_id );
			if ( $master ) {
				$link_source = $master;
			}
		}
		$linked_post_ids      = EventDates::get_linked_post_ids( $link_source->id );
		$data['linked_posts'] = array();
		foreach ( $linked_post_ids as $linked_post_id ) {
			$linked_post = get_post( $linked_post_id );
			if ( $linked_post ) {
				$data['linked_posts'][] = array(
					'id'         => $linked_post->ID,
					'title'      => $linked_post->post_title,
					'status'     => $linked_post->post_status,
					'edit_url'   => get_edit_post_link( $linked_post->ID, 'raw' ),
					'view_url'   => get_permalink( $linked_post->ID ),
					'is_primary' => (int) $linked_post->ID === (int) $link_source->event_id,
				);
			}
		}

		// Add linked post info if applicable (primary post).
		if ( $event_date->event_id ) {
			$post = get_post( $event_date->event_id );
			if ( $post ) {
				$data['post'] = array(
					'id'       => $post->ID,
					'title'    => $post->post_title,
					'status'   => $post->post_status,
					'edit_url' => get_edit_post_link( $post->ID, 'raw' ),
				);
			}

			// Add photo gallery info.
			$photo_repo     = new EventPhotoRepository();
			$photo_count    = $photo_repo->get_count_by_event_date( $event_date->id );
			$total_likes    = 0;
			$attachment_ids = $photo_repo->get_attachment_ids_by_event_date( $event_date->id );
			if ( ! empty( $attachment_ids ) ) {
				$like_repo   = new PhotoLikeRepository();
				$like_counts = $like_repo->get_counts_for_photos( $attachment_ids );
				$total_likes = array_sum( $like_counts );
			}
			$data['gallery'] = array(
				'photo_count' => $photo_count,
				'total_likes' => $total_likes,
				'gallery_url' => EventGalleryPage::get_gallery_url( $event_date->id ),
			);
		}

		return $data;
	}

	/**
	 * Get categories for an event date
	 *
	 * @param object $event_date Event date object.
	 * @return array Array of category objects with id, name, slug.
	 */
	private function get_event_date_categories( $event_date ) {
		if ( $event_date->event_id ) {
			$terms = wp_get_post_terms( $event_date->event_id, 'category' );
			if ( is_wp_error( $terms ) ) {
				return array();
			}
			return array_map(
				function ( $term ) {
					return array(
						'id'   => $term->term_id,
						'name' => $term->name,
						'slug' => $term->slug,
					);
				},
				$terms
			);
		}

		return $this->get_standalone_categories( $event_date->id );
	}

	/**
	 * Get categories for a standalone event date from junction table
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Array of category objects with id, name, slug.
	 */
	private function get_standalone_categories( $event_date_id ) {
		$term_ids = $this->get_standalone_category_ids( $event_date_id );
		if ( empty( $term_ids ) ) {
			return array();
		}

		$categories = array();
		foreach ( $term_ids as $term_id ) {
			$term = get_term( $term_id, 'category' );
			if ( $term && ! is_wp_error( $term ) ) {
				$categories[] = array(
					'id'   => $term->term_id,
					'name' => $term->name,
					'slug' => $term->slug,
				);
			}
		}
		return $categories;
	}

	/**
	 * Get category term IDs for a standalone event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Array of term IDs.
	 */
	private function get_standalone_category_ids( $event_date_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_date_categories';

		$term_ids = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT term_id FROM %i WHERE event_date_id = %d',
				$table_name,
				$event_date_id
			)
		);

		return array_map( 'intval', $term_ids );
	}

	/**
	 * Set categories for a standalone event date in junction table
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param array $category_ids  Array of term IDs.
	 * @return void
	 */
	private function set_standalone_categories( $event_date_id, $category_ids ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_date_categories';

		// Delete existing rows.
		$wpdb->delete(
			$table_name,
			array( 'event_date_id' => $event_date_id ),
			array( '%d' )
		);

		// Insert new rows.
		foreach ( $category_ids as $term_id ) {
			$wpdb->insert(
				$table_name,
				array(
					'event_date_id' => $event_date_id,
					'term_id'       => (int) $term_id,
				),
				array( '%d', '%d' )
			);
		}
	}

	/**
	 * Check permissions for getting single item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function get_item_permissions_check( $request ) {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Check permissions for creating item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function create_item_permissions_check( $request ) {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Check permissions for updating item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function update_item_permissions_check( $request ) {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Check permissions for deleting item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function delete_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
