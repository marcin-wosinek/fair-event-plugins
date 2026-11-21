<?php
/**
 * REST API controller for event and programme-item images.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEvents\Models\EventDates;
use FairEventsExperimental\EventImages\EventImages;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Ordered images with optional focal regions (#2397).
 *
 * - `GET /fair-events-experimental/v1/event-dates/{id}/images` — the event's
 *   own list and one list per saved programme item.
 * - `PUT …/images/event` and `PUT …/images/schedule-items/{schedule_item_id}`
 *   — replace one list, given the `revision` it was loaded at.
 *
 * Registered only while the `event-images` bundle is on. Access is for
 * people who manage events and may edit this event's page. See
 * docs/event-images.md.
 */
class EventImagesController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events-experimental/v1';

	/**
	 * Resource name.
	 *
	 * @var string
	 */
	protected $rest_base = 'event-dates';

	/**
	 * Register the routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$id_arg = array(
			'description' => __( 'Event date ID.', 'fair-events-experimental' ),
			'type'        => 'integer',
			'required'    => true,
		);

		$write_args = array(
			'revision' => array(
				'description' => __( 'Revision of the list as it was loaded. The save is refused when the list changed since.', 'fair-events-experimental' ),
				'type'        => 'string',
				'required'    => true,
			),
			'images'   => array(
				'description'       => __( 'Every image of the list, in order. Images left out are unlinked.', 'fair-events-experimental' ),
				'type'              => 'array',
				'required'          => true,
				'items'             => array( 'type' => 'object' ),
				// Schema-only bounds are not enforced on hand-written args.
				'validate_callback' => static function ( $value ) {
					return is_array( $value ) && count( $value ) <= EventImages::MAX_IMAGES;
				},
			),
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/images',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array( 'id' => $id_arg ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/images/event',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_event_images' ),
					'permission_callback' => array( $this, 'update_items_permissions_check' ),
					'args'                => array_merge( array( 'id' => $id_arg ), $write_args ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/images/schedule-items/(?P<schedule_item_id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_schedule_item_images' ),
					'permission_callback' => array( $this, 'update_items_permissions_check' ),
					'args'                => array_merge(
						array(
							'id'               => $id_arg,
							'schedule_item_id' => array(
								'description' => __( 'Programme item ID.', 'fair-events-experimental' ),
								'type'        => 'integer',
								'required'    => true,
							),
						),
						$write_args
					),
				),
			)
		);
	}

	/**
	 * Check permission to read an event's images.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function get_items_permissions_check( $request ) {
		return $this->check_permission( $request );
	}

	/**
	 * Check permission to change an event's images.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function update_items_permissions_check( $request ) {
		return $this->check_permission( $request );
	}

	/**
	 * People who manage events (edit_posts) and may edit this event's page:
	 * the linked post's edit_post for a linked event (an occurrence uses
	 * its series' post). A missing event date passes through to the
	 * callback's 404.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	private function check_permission( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in.', 'fair-events-experimental' ),
				array( 'status' => 401 )
			);
		}

		if ( ! current_user_can( 'edit_posts' ) ) {
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
	 * Read every image list of an event date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_items( $request ) {
		$event_date = EventDates::get_by_id( (int) $request['id'] );
		if ( ! $event_date ) {
			return $this->not_found();
		}

		return new WP_REST_Response( EventImages::get_payload( $event_date ), 200 );
	}

	/**
	 * Replace the event's own images.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_event_images( $request ) {
		return $this->save( $request, 0 );
	}

	/**
	 * Replace a programme item's images.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_schedule_item_images( $request ) {
		return $this->save( $request, (int) $request['schedule_item_id'] );
	}

	/**
	 * Replace one list.
	 *
	 * @param WP_REST_Request $request          Request object.
	 * @param int             $schedule_item_id Programme item ID, 0 for the event.
	 * @return WP_REST_Response|WP_Error
	 */
	private function save( $request, $schedule_item_id ) {
		$event_date = EventDates::get_by_id( (int) $request['id'] );
		if ( ! $event_date ) {
			return $this->not_found();
		}

		$result = EventImages::save(
			$event_date,
			$schedule_item_id,
			(string) $request->get_param( 'revision' ),
			(array) $request->get_param( 'images' )
		);
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result, 200 );
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
	 * Error for a user who may not manage this event's images.
	 *
	 * @return WP_Error
	 */
	private function forbidden() {
		return new WP_Error(
			'rest_forbidden',
			__( 'You do not have permission to manage this event\'s images.', 'fair-events-experimental' ),
			array( 'status' => 403 )
		);
	}
}
