<?php
/**
 * REST API Controller for the event schedule
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairEvents\Services\EventSchedule;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles the event schedule REST API endpoints
 */
class EventScheduleController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Register the routes for the schedule
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/schedule',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'items_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_items' ),
					'permission_callback' => array( $this, 'items_permissions_check' ),
					'args'                => array(
						'id'    => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
						'items' => array(
							'description'       => __( 'Every schedule entry, in display order. Entries left out are removed.', 'fair-events' ),
							'type'              => 'array',
							'required'          => true,
							'items'             => array( 'type' => 'object' ),
							// Schema-only bounds are not enforced on
							// hand-written args, so check the size here.
							'validate_callback' => static function ( $value ) {
								return is_array( $value ) && count( $value ) <= EventSchedule::MAX_ITEMS;
							},
						),
					),
				),
			)
		);
	}

	/**
	 * Check permissions for schedule operations: the same capability as the
	 * rest of Manage Event.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if user has permission.
	 */
	public function items_permissions_check( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in.', 'fair-events' ),
				array( 'status' => 401 )
			);
		}

		if ( ! current_user_can( 'edit_posts' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to manage this event\'s schedule.', 'fair-events' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Get the schedule of an event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function get_items( $request ) {
		$event_date = EventDates::get_by_id( (int) $request->get_param( 'id' ) );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( EventSchedule::get_payload( $event_date ), 200 );
	}

	/**
	 * Save the whole schedule of an event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function update_items( $request ) {
		$event_date = EventDates::get_by_id( (int) $request->get_param( 'id' ) );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$result = EventSchedule::save( $event_date, (array) $request->get_param( 'items' ) );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result, 200 );
	}
}
