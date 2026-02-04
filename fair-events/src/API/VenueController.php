<?php
/**
 * REST API Controller for Venues
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Models\Venue;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles venue REST API endpoints
 */
class VenueController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Register the routes for venues
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-events/v1/venues - Get all venues
		// POST /fair-events/v1/venues - Create venue
		register_rest_route(
			$this->namespace,
			'/venues',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => $this->get_create_update_args(),
				),
			)
		);

		// GET /fair-events/v1/venues/{id} - Get single venue
		// PUT /fair-events/v1/venues/{id} - Update venue
		// DELETE /fair-events/v1/venues/{id} - Delete venue
		register_rest_route(
			$this->namespace,
			'/venues/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the venue.', 'fair-events' ),
							'type'        => 'integer',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => $this->get_create_update_args(),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the venue.', 'fair-events' ),
							'type'        => 'integer',
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
			'name'               => array(
				'description'       => __( 'Venue name.', 'fair-events' ),
				'type'              => 'string',
				'required'          => true,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'address'            => array(
				'description'       => __( 'Venue address.', 'fair-events' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'sanitize_textarea_field',
			),
			'google_maps_link'   => array(
				'description'       => __( 'Google Maps URL.', 'fair-events' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'esc_url_raw',
			),
			'latitude'           => array(
				'description'       => __( 'Latitude coordinate.', 'fair-events' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'longitude'          => array(
				'description'       => __( 'Longitude coordinate.', 'fair-events' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'facebook_page_link' => array(
				'description'       => __( 'Facebook page URL.', 'fair-events' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'esc_url_raw',
			),
			'instagram_handle'   => array(
				'description'       => __( 'Instagram handle (without @).', 'fair-events' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'sanitize_text_field',
			),
		);
	}

	/**
	 * Get all venues
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_items( $request ) {
		$venues = Venue::get_all();

		$data = array_map(
			function ( $venue ) {
				return $venue->to_array();
			},
			$venues
		);

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Get single venue
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_item( $request ) {
		$id    = (int) $request->get_param( 'id' );
		$venue = Venue::get_by_id( $id );

		if ( ! $venue ) {
			return new WP_Error(
				'rest_venue_not_found',
				__( 'Venue not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $venue->to_array(), 200 );
	}

	/**
	 * Create new venue
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_item( $request ) {
		$name               = $request->get_param( 'name' );
		$address            = $request->get_param( 'address' );
		$google_maps_link   = $request->get_param( 'google_maps_link' );
		$latitude           = $request->get_param( 'latitude' );
		$longitude          = $request->get_param( 'longitude' );
		$facebook_page_link = $request->get_param( 'facebook_page_link' );
		$instagram_handle   = $request->get_param( 'instagram_handle' );

		if ( empty( $name ) ) {
			return new WP_Error(
				'rest_invalid_name',
				__( 'Venue name is required.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$venue_id = Venue::create( $name, $address, $google_maps_link, $latitude, $longitude, $facebook_page_link, $instagram_handle );

		if ( ! $venue_id ) {
			return new WP_Error(
				'rest_venue_creation_failed',
				__( 'Failed to create venue.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		$venue = Venue::get_by_id( $venue_id );

		return new WP_REST_Response( $venue->to_array(), 201 );
	}

	/**
	 * Update venue
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function update_item( $request ) {
		$id                 = (int) $request->get_param( 'id' );
		$name               = $request->get_param( 'name' );
		$address            = $request->get_param( 'address' );
		$google_maps_link   = $request->get_param( 'google_maps_link' );
		$latitude           = $request->get_param( 'latitude' );
		$longitude          = $request->get_param( 'longitude' );
		$facebook_page_link = $request->get_param( 'facebook_page_link' );
		$instagram_handle   = $request->get_param( 'instagram_handle' );

		// Check if venue exists.
		$existing = Venue::get_by_id( $id );
		if ( ! $existing ) {
			return new WP_Error(
				'rest_venue_not_found',
				__( 'Venue not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		if ( empty( $name ) ) {
			return new WP_Error(
				'rest_invalid_name',
				__( 'Venue name is required.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$success = Venue::update( $id, $name, $address, $google_maps_link, $latitude, $longitude, $facebook_page_link, $instagram_handle );

		if ( ! $success ) {
			return new WP_Error(
				'rest_venue_update_failed',
				__( 'Failed to update venue.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		$venue = Venue::get_by_id( $id );

		return new WP_REST_Response( $venue->to_array(), 200 );
	}

	/**
	 * Delete venue
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function delete_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		// Check if venue exists.
		$existing = Venue::get_by_id( $id );
		if ( ! $existing ) {
			return new WP_Error(
				'rest_venue_not_found',
				__( 'Venue not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$success = Venue::delete( $id );

		if ( ! $success ) {
			return new WP_Error(
				'rest_venue_delete_failed',
				__( 'Failed to delete venue.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted' => true,
				'venue'   => $existing->to_array(),
			),
			200
		);
	}

	/**
	 * Check permissions for getting items
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function get_items_permissions_check( $request ) {
		// Allow users who can edit posts (needed for venue selector in event meta box).
		return current_user_can( 'edit_posts' );
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
		// Allow users who can edit posts to create venues inline from event editor.
		return current_user_can( 'edit_posts' );
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
