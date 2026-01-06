<?php
/**
 * REST API Controller for Event Sources
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Database\EventSourceRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles event source REST API endpoints
 */
class EventSourceController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Repository instance
	 *
	 * @var EventSourceRepository
	 */
	private $repository;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->repository = new EventSourceRepository();
	}

	/**
	 * Register the routes for event sources
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-events/v1/sources - Get all sources
		// POST /fair-events/v1/sources - Create source
		register_rest_route(
			$this->namespace,
			'/sources',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'enabled_only' => array(
							'description' => __( 'Fetch only enabled sources.', 'fair-events' ),
							'type'        => 'boolean',
							'default'     => false,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
				),
			)
		);

		// GET /fair-events/v1/sources/{id} - Get single source
		// PUT /fair-events/v1/sources/{id} - Update source
		// DELETE /fair-events/v1/sources/{id} - Delete source
		register_rest_route(
			$this->namespace,
			'/sources/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the source.', 'fair-events' ),
							'type'        => 'integer',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the source.', 'fair-events' ),
							'type'        => 'integer',
						),
					),
				),
			)
		);

		// GET /fair-events/v1/sources/categories - Get available categories
		register_rest_route(
			$this->namespace,
			'/sources/categories',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_categories' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
				),
			)
		);

		// GET /fair-events/v1/sources/{slug}/ical - Get iCal feed for source
		register_rest_route(
			$this->namespace,
			'/sources/(?P<slug>[a-z0-9-]+)/ical',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_ical_feed' ),
					'permission_callback' => '__return_true', // Public endpoint
					'args'                => array(
						'slug' => array(
							'description' => __( 'Unique slug identifier for the source.', 'fair-events' ),
							'type'        => 'string',
						),
					),
				),
			)
		);
	}

	/**
	 * Get all event sources
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_items( $request ) {
		$enabled_only = $request->get_param( 'enabled_only' );
		$sources      = $this->repository->get_all( $enabled_only );

		return new WP_REST_Response( $sources, 200 );
	}

	/**
	 * Get single event source
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_item( $request ) {
		$id     = (int) $request->get_param( 'id' );
		$source = $this->repository->get_by_id( $id );

		if ( ! $source ) {
			return new WP_Error(
				'rest_source_not_found',
				__( 'Source not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $source, 200 );
	}

	/**
	 * Create new event source
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_item( $request ) {
		$name         = sanitize_text_field( $request->get_param( 'name' ) );
		$slug         = $request->get_param( 'slug' );
		$data_sources = $request->get_param( 'data_sources' );
		$enabled      = $request->get_param( 'enabled' ) ?? true;

		// Generate slug from name if not provided
		if ( empty( $slug ) ) {
			$slug = sanitize_title( $name );
		} else {
			$slug = sanitize_title( $slug );
		}

		// Check if slug already exists
		$existing = $this->repository->get_by_slug( $slug );
		if ( $existing ) {
			return new WP_Error(
				'rest_slug_exists',
				__( 'A source with this slug already exists.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// Validate data_sources
		$validation_error = $this->validate_data_sources( $data_sources );
		if ( is_wp_error( $validation_error ) ) {
			return $validation_error;
		}

		$source_id = $this->repository->create( $name, $slug, $data_sources, $enabled );

		if ( ! $source_id ) {
			return new WP_Error(
				'rest_source_creation_failed',
				__( 'Failed to create source.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		$source = $this->repository->get_by_id( $source_id );

		return new WP_REST_Response( $source, 201 );
	}

	/**
	 * Update event source
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function update_item( $request ) {
		$id           = (int) $request->get_param( 'id' );
		$name         = sanitize_text_field( $request->get_param( 'name' ) );
		$slug         = $request->get_param( 'slug' );
		$data_sources = $request->get_param( 'data_sources' );
		$enabled      = $request->get_param( 'enabled' ) ?? true;

		// Check if source exists
		$existing = $this->repository->get_by_id( $id );
		if ( ! $existing ) {
			return new WP_Error(
				'rest_source_not_found',
				__( 'Source not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Generate slug from name if not provided
		if ( empty( $slug ) ) {
			$slug = sanitize_title( $name );
		} else {
			$slug = sanitize_title( $slug );
		}

		// Check if slug exists (but allow current source to keep its slug)
		$slug_check = $this->repository->get_by_slug( $slug );
		if ( $slug_check && (int) $slug_check['id'] !== $id ) {
			return new WP_Error(
				'rest_slug_exists',
				__( 'A source with this slug already exists.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// Validate data_sources
		$validation_error = $this->validate_data_sources( $data_sources );
		if ( is_wp_error( $validation_error ) ) {
			return $validation_error;
		}

		$success = $this->repository->update( $id, $name, $slug, $data_sources, $enabled );

		if ( ! $success ) {
			return new WP_Error(
				'rest_source_update_failed',
				__( 'Failed to update source.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		$source = $this->repository->get_by_id( $id );

		return new WP_REST_Response( $source, 200 );
	}

	/**
	 * Delete event source
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function delete_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		// Check if source exists
		$existing = $this->repository->get_by_id( $id );
		if ( ! $existing ) {
			return new WP_Error(
				'rest_source_not_found',
				__( 'Source not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$success = $this->repository->delete( $id );

		if ( ! $success ) {
			return new WP_Error(
				'rest_source_delete_failed',
				__( 'Failed to delete source.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted' => true,
				'source'  => $existing,
			),
			200
		);
	}

	/**
	 * Get available categories for event categorization
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_categories( $request ) {
		$categories = get_terms(
			array(
				'taxonomy'   => 'category',
				'hide_empty' => false,
				'orderby'    => 'name',
				'order'      => 'ASC',
			)
		);

		if ( is_wp_error( $categories ) ) {
			return new WP_REST_Response( array(), 200 );
		}

		$formatted = array_map(
			function ( $category ) {
				return array(
					'id'   => $category->term_id,
					'name' => $category->name,
					'slug' => $category->slug,
				);
			},
			$categories
		);

		return new WP_REST_Response( $formatted, 200 );
	}

	/**
	 * Get iCal feed for a source
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_ical_feed( $request ) {
		$slug   = $request->get_param( 'slug' );
		$source = $this->repository->get_by_slug( $slug );

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

		// Collect all category IDs from data sources
		$category_ids = array();
		foreach ( $source['data_sources'] as $data_source ) {
			if ( 'categories' === $data_source['source_type'] && isset( $data_source['config']['category_ids'] ) ) {
				$category_ids = array_merge( $category_ids, $data_source['config']['category_ids'] );
			}
		}

		// Query events
		$query_args = array(
			'post_type'      => 'fair_event',
			'posts_per_page' => -1,
			'post_status'    => 'publish',
			'orderby'        => 'meta_value',
			'meta_key'       => '_fair_event_start_date',
			'order'          => 'ASC',
		);

		// Add category filter if we have categories
		if ( ! empty( $category_ids ) ) {
			$query_args['category__in'] = array_unique( $category_ids );
		}

		$events = get_posts( $query_args );

		// Generate iCal content
		$ical = $this->generate_ical( $events, $source );

		// Return with proper headers
		$response = new WP_REST_Response( $ical, 200 );
		$response->header( 'Content-Type', 'text/calendar; charset=utf-8' );
		$response->header( 'Content-Disposition', 'attachment; filename="' . $slug . '.ics"' );

		return $response;
	}

	/**
	 * Generate iCal content from events
	 *
	 * @param array $events Array of WP_Post objects.
	 * @param array $source Event source data.
	 * @return string iCal formatted content.
	 */
	private function generate_ical( $events, $source ) {
		$ical  = "BEGIN:VCALENDAR\r\n";
		$ical .= "VERSION:2.0\r\n";
		$ical .= 'PRODID:-//Fair Events//Event Source: ' . $source['name'] . "//EN\r\n";
		$ical .= "CALSCALE:GREGORIAN\r\n";
		$ical .= 'X-WR-CALNAME:' . $this->escape_ical( $source['name'] ) . "\r\n";
		$ical .= "X-WR-TIMEZONE:UTC\r\n";

		foreach ( $events as $event ) {
			$start_date = get_post_meta( $event->ID, '_fair_event_start_date', true );
			$end_date   = get_post_meta( $event->ID, '_fair_event_end_date', true );

			if ( ! $start_date ) {
				continue;
			}

			// Format dates for iCal (YYYYMMDDTHHMMSSZ)
			$dtstart = gmdate( 'Ymd\THis\Z', strtotime( $start_date ) );
			$dtend   = $end_date ? gmdate( 'Ymd\THis\Z', strtotime( $end_date ) ) : gmdate( 'Ymd\THis\Z', strtotime( $start_date ) + 3600 );

			$ical .= "BEGIN:VEVENT\r\n";
			$ical .= 'UID:' . $event->ID . '@' . get_site_url() . "\r\n";
			$ical .= 'DTSTAMP:' . gmdate( 'Ymd\THis\Z' ) . "\r\n";
			$ical .= 'DTSTART:' . $dtstart . "\r\n";
			$ical .= 'DTEND:' . $dtend . "\r\n";
			$ical .= 'SUMMARY:' . $this->escape_ical( $event->post_title ) . "\r\n";

			if ( $event->post_content ) {
				$description = wp_strip_all_tags( $event->post_content );
				$ical       .= 'DESCRIPTION:' . $this->escape_ical( $description ) . "\r\n";
			}

			$ical .= 'URL:' . get_permalink( $event->ID ) . "\r\n";
			$ical .= "STATUS:CONFIRMED\r\n";
			$ical .= "END:VEVENT\r\n";
		}

		$ical .= "END:VCALENDAR\r\n";

		return $ical;
	}

	/**
	 * Escape text for iCal format
	 *
	 * @param string $text Text to escape.
	 * @return string Escaped text.
	 */
	private function escape_ical( $text ) {
		$text = str_replace( array( "\r\n", "\n", "\r" ), ' ', $text );
		$text = str_replace( array( '\\', ',', ';' ), array( '\\\\', '\\,', '\\;' ), $text );
		return $text;
	}

	/**
	 * Validate data sources array
	 *
	 * @param array $data_sources Data sources array.
	 * @return true|WP_Error True if valid, WP_Error if invalid.
	 */
	private function validate_data_sources( $data_sources ) {
		if ( ! is_array( $data_sources ) ) {
			return new WP_Error(
				'rest_invalid_data_sources',
				__( 'Data sources must be an array.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		if ( empty( $data_sources ) ) {
			return new WP_Error(
				'rest_empty_data_sources',
				__( 'At least one data source is required.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		foreach ( $data_sources as $index => $data_source ) {
			if ( ! isset( $data_source['source_type'] ) || ! isset( $data_source['config'] ) ) {
				return new WP_Error(
					'rest_invalid_data_source',
					/* translators: %d: Data source index */
					sprintf( __( 'Data source at index %d is missing source_type or config.', 'fair-events' ), $index ),
					array( 'status' => 400 )
				);
			}

			$validation_error = $this->validate_single_data_source( $data_source['source_type'], $data_source['config'], $index );
			if ( is_wp_error( $validation_error ) ) {
				return $validation_error;
			}
		}

		return true;
	}

	/**
	 * Validate single data source configuration
	 *
	 * @param string $source_type Source type.
	 * @param array  $config Configuration array.
	 * @param int    $index Data source index for error messages.
	 * @return true|WP_Error True if valid, WP_Error if invalid.
	 */
	private function validate_single_data_source( $source_type, $config, $index ) {
		$valid_types = array( 'categories', 'ical_url', 'meetup_api' );
		if ( ! in_array( $source_type, $valid_types, true ) ) {
			return new WP_Error(
				'rest_invalid_source_type',
				/* translators: %d: Data source index */
				sprintf( __( 'Invalid source type at index %d.', 'fair-events' ), $index ),
				array( 'status' => 400 )
			);
		}

		if ( ! is_array( $config ) ) {
			return new WP_Error(
				'rest_invalid_config',
				/* translators: %d: Data source index */
				sprintf( __( 'Config at index %d must be an object.', 'fair-events' ), $index ),
				array( 'status' => 400 )
			);
		}

		switch ( $source_type ) {
			case 'categories':
				if ( ! isset( $config['category_ids'] ) || ! is_array( $config['category_ids'] ) ) {
					return new WP_Error(
						'rest_invalid_config',
						/* translators: %d: Data source index */
						sprintf( __( 'Categories source at index %d requires category_ids array.', 'fair-events' ), $index ),
						array( 'status' => 400 )
					);
				}

				// Validate that categories exist
				foreach ( $config['category_ids'] as $cat_id ) {
					if ( ! term_exists( (int) $cat_id, 'category' ) ) {
						return new WP_Error(
							'rest_invalid_category',
							/* translators: 1: Category ID, 2: Data source index */
							sprintf( __( 'Category ID %1$d does not exist (data source index %2$d).', 'fair-events' ), $cat_id, $index ),
							array( 'status' => 400 )
						);
					}
				}
				break;

			case 'ical_url':
				if ( ! isset( $config['url'] ) || empty( $config['url'] ) ) {
					return new WP_Error(
						'rest_invalid_config',
						/* translators: %d: Data source index */
						sprintf( __( 'iCal source at index %d requires url field.', 'fair-events' ), $index ),
						array( 'status' => 400 )
					);
				}

				// Validate URL format
				if ( ! filter_var( $config['url'], FILTER_VALIDATE_URL ) ) {
					return new WP_Error(
						'rest_invalid_url',
						/* translators: %d: Data source index */
						sprintf( __( 'Invalid URL format at index %d.', 'fair-events' ), $index ),
						array( 'status' => 400 )
					);
				}
				break;

			case 'meetup_api':
				// Placeholder validation - no strict requirements yet
				break;

			default:
				return new WP_Error(
					'rest_invalid_source_type',
					/* translators: %d: Data source index */
					sprintf( __( 'Unknown source type at index %d.', 'fair-events' ), $index ),
					array( 'status' => 400 )
				);
		}

		return true;
	}

	/**
	 * Check permissions for getting items
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for getting single item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function get_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for creating item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function create_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for updating item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function update_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
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
