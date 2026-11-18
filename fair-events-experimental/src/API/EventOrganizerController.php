<?php
/**
 * REST API controller for an event's organizer.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEvents\Models\EventDates;
use FairEventsExperimental\Services\EventOrganizer;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Administrator-only read and change of the organizer assigned to an event
 * (#2305).
 *
 * GET and PUT `/fair-events/v1/event-dates/{id}/organizer`, and GET
 * `/fair-events/v1/event-organizers` for a new event's picker. A series has one
 * organizer, chosen on the series: a generated occurrence reads it and
 * names the series, and a write to the occurrence is refused. The picker
 * options carry only IDs and names, never the private notification
 * addresses.
 */
class EventOrganizerController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Resource name.
	 *
	 * @var string
	 */
	protected $rest_base = 'event-dates';

	/**
	 * Assignment service.
	 *
	 * @var EventOrganizer
	 */
	private $service;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->service = new EventOrganizer();
	}

	/**
	 * Register the routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		// Picker options for a new event (the calendar's Create Event popup).
		register_rest_route(
			$this->namespace,
			'/event-organizers',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_options' ),
					'permission_callback' => array( $this, 'get_options_permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/organizer',
			array(
				'args' => array(
					'id' => array(
						'description' => __( 'Unique identifier for the event date.', 'fair-events-experimental' ),
						'type'        => 'integer',
					),
				),
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'organizer_id' => array(
							'description' => __( 'Organizer ID: "default" for the sitewide organizer, or an additional organizer\'s UUID.', 'fair-events-experimental' ),
							'type'        => 'string',
							'required'    => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Check permission to list the organizers a new event can use.
	 *
	 * @return true|WP_Error
	 */
	public function get_options_permissions_check() {
		return current_user_can( 'manage_options' ) ? true : $this->forbidden();
	}

	/**
	 * List the organizers a new event can use: IDs and names only.
	 *
	 * @return WP_REST_Response
	 */
	public function get_options() {
		return new WP_REST_Response(
			array(
				'organizer_id' => \FairEventsExperimental\Models\OrganizerRepository::DEFAULT_ID,
				'organizers'   => $this->service->options(),
			),
			200
		);
	}

	/**
	 * Check permission to read an event's organizer.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function get_item_permissions_check( $request ) {
		return $this->check_permission( $request );
	}

	/**
	 * Check permission to change an event's organizer.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function update_item_permissions_check( $request ) {
		return $this->check_permission( $request );
	}

	/**
	 * Administrators who may also edit the event itself: the linked post's
	 * edit_post for a linked event (an occurrence uses its series' post).
	 * A missing event date passes through to the callback's 404.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	private function check_permission( $request ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return $this->forbidden();
		}

		$event_date = EventDates::get_by_id( (int) $request['id'] );
		if ( ! $event_date ) {
			return true;
		}

		$post_id = (int) $event_date->get_resolved_event_id();
		if ( $post_id > 0 && get_post( $post_id ) && ! current_user_can( 'edit_post', $post_id ) ) {
			return $this->forbidden();
		}

		return true;
	}

	/**
	 * Read the organizer of an event date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		$event_date = EventDates::get_by_id( (int) $request['id'] );
		if ( ! $event_date ) {
			return $this->not_found();
		}

		return new WP_REST_Response( $this->response( $event_date ), 200 );
	}

	/**
	 * Assign an organizer to an event date, or reset it to the sitewide one.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$event_date = EventDates::get_by_id( (int) $request['id'] );
		if ( ! $event_date ) {
			return $this->not_found();
		}

		if ( EventOrganizer::owner_id( $event_date ) !== (int) $event_date->id ) {
			return new WP_Error(
				'rest_organizer_managed_on_series',
				__( 'This date is part of a series. Choose the organizer on the series.', 'fair-events-experimental' ),
				array( 'status' => 409 )
			);
		}

		$organizer_id = $request->get_param( 'organizer_id' );
		if ( ! $this->service->is_assignable( $organizer_id ) ) {
			return new WP_Error(
				'rest_invalid_organizer',
				__( 'Choose the sitewide organizer or one of the organizers in the list.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}

		if ( ! $this->service->save( (int) $event_date->id, $organizer_id ) ) {
			return new WP_Error(
				'rest_organizer_save_failed',
				__( 'The organizer could not be saved. Try again.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response( $this->response( $event_date ), 200 );
	}

	/**
	 * Build the response for an event date.
	 *
	 * @param EventDates $event_date Requested event date.
	 * @return array{organizer_id: string, effective_organizer_id: string, series_event_date_id: int|null, organizers: array[]}
	 */
	private function response( EventDates $event_date ) {
		$owner_id  = EventOrganizer::owner_id( $event_date );
		$effective = $this->service->effective( $event_date );

		return array(
			'organizer_id'           => $this->service->saved_id( $event_date ),
			'effective_organizer_id' => $effective['id'],
			'series_event_date_id'   => $owner_id !== (int) $event_date->id ? $owner_id : null,
			'organizers'             => $this->service->options(),
		);
	}

	/**
	 * Error for a missing event date.
	 *
	 * @return WP_Error
	 */
	private function not_found() {
		return new WP_Error(
			'rest_event_date_not_found',
			__( 'Event date not found.', 'fair-events-experimental' ),
			array( 'status' => 404 )
		);
	}

	/**
	 * Error for a user who may not manage this event's organizer.
	 *
	 * @return WP_Error
	 */
	private function forbidden() {
		return new WP_Error(
			'rest_forbidden',
			__( 'You do not have permission to change this event\'s organizer.', 'fair-events-experimental' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
}
