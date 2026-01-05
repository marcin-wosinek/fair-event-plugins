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
		$name        = sanitize_text_field( $request->get_param( 'name' ) );
		$source_type = sanitize_text_field( $request->get_param( 'source_type' ) );
		$config      = $request->get_param( 'config' );
		$color       = sanitize_hex_color( $request->get_param( 'color' ) ) ?? '#000000';
		$enabled     = $request->get_param( 'enabled' ) ?? true;

		// Validate source type
		$valid_types = array( 'categories', 'ical_url', 'meetup_api' );
		if ( ! in_array( $source_type, $valid_types, true ) ) {
			return new WP_Error(
				'rest_invalid_source_type',
				__( 'Invalid source type.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// Validate config based on type
		$validation_error = $this->validate_config( $source_type, $config );
		if ( is_wp_error( $validation_error ) ) {
			return $validation_error;
		}

		$source_id = $this->repository->create( $name, $source_type, $config, $color, $enabled );

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
		$id          = (int) $request->get_param( 'id' );
		$name        = sanitize_text_field( $request->get_param( 'name' ) );
		$source_type = sanitize_text_field( $request->get_param( 'source_type' ) );
		$config      = $request->get_param( 'config' );
		$color       = sanitize_hex_color( $request->get_param( 'color' ) ) ?? '#000000';
		$enabled     = $request->get_param( 'enabled' ) ?? true;

		// Check if source exists
		$existing = $this->repository->get_by_id( $id );
		if ( ! $existing ) {
			return new WP_Error(
				'rest_source_not_found',
				__( 'Source not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Validate source type
		$valid_types = array( 'categories', 'ical_url', 'meetup_api' );
		if ( ! in_array( $source_type, $valid_types, true ) ) {
			return new WP_Error(
				'rest_invalid_source_type',
				__( 'Invalid source type.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// Validate config
		$validation_error = $this->validate_config( $source_type, $config );
		if ( is_wp_error( $validation_error ) ) {
			return $validation_error;
		}

		$success = $this->repository->update( $id, $name, $source_type, $config, $color, $enabled );

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
	 * Validate configuration based on source type
	 *
	 * @param string $source_type Source type.
	 * @param array  $config Configuration array.
	 * @return true|WP_Error True if valid, WP_Error if invalid.
	 */
	private function validate_config( $source_type, $config ) {
		if ( ! is_array( $config ) ) {
			return new WP_Error(
				'rest_invalid_config',
				__( 'Config must be an object.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		switch ( $source_type ) {
			case 'categories':
				if ( ! isset( $config['category_ids'] ) || ! is_array( $config['category_ids'] ) ) {
					return new WP_Error(
						'rest_invalid_config',
						__( 'Categories source requires category_ids array.', 'fair-events' ),
						array( 'status' => 400 )
					);
				}

				// Validate that categories exist
				foreach ( $config['category_ids'] as $cat_id ) {
					if ( ! term_exists( (int) $cat_id, 'category' ) ) {
						return new WP_Error(
							'rest_invalid_category',
							/* translators: %d: Category ID */
							sprintf( __( 'Category ID %d does not exist.', 'fair-events' ), $cat_id ),
							array( 'status' => 400 )
						);
					}
				}
				break;

			case 'ical_url':
				if ( ! isset( $config['url'] ) || empty( $config['url'] ) ) {
					return new WP_Error(
						'rest_invalid_config',
						__( 'iCal source requires url field.', 'fair-events' ),
						array( 'status' => 400 )
					);
				}

				// Validate URL format
				if ( ! filter_var( $config['url'], FILTER_VALIDATE_URL ) ) {
					return new WP_Error(
						'rest_invalid_url',
						__( 'Invalid URL format.', 'fair-events' ),
						array( 'status' => 400 )
					);
				}
				break;

			case 'meetup_api':
				// Placeholder validation - no strict requirements yet
				// Future: Validate api_key and group_id when implementing
				break;

			default:
				return new WP_Error(
					'rest_invalid_source_type',
					__( 'Unknown source type.', 'fair-events' ),
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
