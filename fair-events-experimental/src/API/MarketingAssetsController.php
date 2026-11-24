<?php
/**
 * REST API controller for occurrence marketing assets.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEvents\Models\EventDates;
use FairEventsExperimental\Services\MarketingAssets;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Authenticated management of an occurrence's marketing assets (#2396).
 *
 * - `GET`, `POST /fair-events/v1/event-dates/{event_date_id}/marketing-assets`
 * - `GET`, `PUT`/`PATCH`, `DELETE …/marketing-assets/{asset_id}`
 * - `GET …/marketing-assets/options` — the team members and schedule items
 *   the date's assets can link, and whether each can be added now.
 *
 * Registered only while the `marketing-assets` bundle is on. Every route
 * requires `manage_options` and, for an event linked to a post, `edit_post`
 * on it. Nothing here is public: anonymous visitors get 401, and member
 * names are never published (#2430). Images are uploaded through the core
 * `POST /wp/v2/media` route and linked by attachment ID. See
 * docs/marketing-assets.md.
 */
class MarketingAssetsController extends WP_REST_Controller {

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
	 * Service.
	 *
	 * @var MarketingAssets
	 */
	private $service;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->service = new MarketingAssets();
	}

	/**
	 * Register the routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$event_date_arg = array(
			'description' => __( 'Event date (occurrence) the assets belong to.', 'fair-events-experimental' ),
			'type'        => 'integer',
		);
		$base           = '/' . $this->rest_base . '/(?P<event_date_id>\d+)/marketing-assets';

		register_rest_route(
			$this->namespace,
			$base,
			array(
				'args' => array( 'event_date_id' => $event_date_arg ),
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => $this->get_collection_params(),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => $this->write_args( true ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/options',
			array(
				'args' => array( 'event_date_id' => $event_date_arg ),
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_options' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/(?P<asset_id>\d+)',
			array(
				'args' => array(
					'event_date_id' => $event_date_arg,
					'asset_id'      => array(
						'description' => __( 'Marketing asset ID.', 'fair-events-experimental' ),
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
					'args'                => $this->write_args( false ),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
				),
			)
		);
	}

	/**
	 * Pagination arguments.
	 *
	 * @return array
	 */
	public function get_collection_params() {
		return array(
			'page'     => array(
				'description' => __( 'Page of the list, from 1.', 'fair-events-experimental' ),
				'type'        => 'integer',
				'default'     => 1,
				'minimum'     => 1,
			),
			'per_page' => array(
				'description' => __( 'Assets per page.', 'fair-events-experimental' ),
				'type'        => 'integer',
				'default'     => 50,
				'minimum'     => 1,
				'maximum'     => 100,
			),
		);
	}

	/**
	 * Arguments of a create or update. No defaults, so an omitted field is
	 * told apart from one sent as null (which clears it).
	 *
	 * @param bool $creating Whether this is a create.
	 * @return array
	 */
	private function write_args( $creating ) {
		return array(
			'label'            => array(
				'description' => __( 'What the asset is for, such as "Instagram post". Required on create; plain text, one line.', 'fair-events-experimental' ),
				'type'        => 'string',
				'required'    => $creating,
			),
			'text'             => array(
				'description' => __( 'Plain text, stored exactly as sent: Unicode, whitespace and line breaks are kept. Empty or null clears it.', 'fair-events-experimental' ),
				'type'        => array( 'string', 'null' ),
			),
			'attachment_id'    => array(
				'description' => __( 'PNG or JPEG attachment from the Media Library (upload with POST /wp/v2/media). Null or 0 unlinks it; the attachment stays in the Media Library.', 'fair-events-experimental' ),
				'type'        => array( 'integer', 'null' ),
				'minimum'     => 0,
			),
			'member_ids'       => array(
				'description' => __( 'Team members of this event to link. Replaces the linked set; [] or null removes every link.', 'fair-events-experimental' ),
				'type'        => array( 'array', 'null' ),
				'items'       => array(
					'type'    => 'integer',
					'minimum' => 1,
				),
			),
			'schedule_item_id' => array(
				'description' => __( 'Schedule item of this event to link. Null or 0 removes the link.', 'fair-events-experimental' ),
				'type'        => array( 'integer', 'null' ),
				'minimum'     => 0,
			),
		);
	}

	/**
	 * Check permission to list assets and read options.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function get_items_permissions_check( $request ) {
		return $this->check_permission( $request );
	}

	/**
	 * Check permission to read an asset.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function get_item_permissions_check( $request ) {
		return $this->check_permission( $request );
	}

	/**
	 * Check permission to create an asset.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function create_item_permissions_check( $request ) {
		return $this->check_permission( $request );
	}

	/**
	 * Check permission to update an asset.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function update_item_permissions_check( $request ) {
		return $this->check_permission( $request );
	}

	/**
	 * Check permission to delete an asset.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function delete_item_permissions_check( $request ) {
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
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in to manage marketing assets.', 'fair-events-experimental' ),
				array( 'status' => 401 )
			);
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			return $this->forbidden();
		}

		$event_date = EventDates::get_by_id( (int) $request['event_date_id'] );
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
	 * List a date's assets.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_items( $request ) {
		$event_date = $this->event_date( $request );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}

		$list     = $this->service->list_assets( $event_date, (int) $request['page'], (int) $request['per_page'] );
		$response = new WP_REST_Response( $list, 200 );
		$response->header( 'X-WP-Total', (string) $list['total'] );
		$response->header( 'X-WP-TotalPages', (string) $list['total_pages'] );
		return $response;
	}

	/**
	 * What a date's assets can link.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_options( $request ) {
		$event_date = $this->event_date( $request );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}

		return new WP_REST_Response( $this->service->options( $event_date ), 200 );
	}

	/**
	 * Read one asset.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		$event_date = $this->event_date( $request );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}

		return rest_ensure_response( $this->service->get_asset( $event_date, (int) $request['asset_id'] ) );
	}

	/**
	 * Create an asset.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$event_date = $this->event_date( $request );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}

		$result = $this->service->create_asset( $event_date, $this->submitted( $request ) );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result, 201 );
	}

	/**
	 * Update an asset.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$event_date = $this->event_date( $request );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}

		return rest_ensure_response( $this->service->update_asset( $event_date, (int) $request['asset_id'], $this->submitted( $request ) ) );
	}

	/**
	 * Delete an asset. The attachment stays in the Media Library.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$event_date = $this->event_date( $request );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}

		$result = $this->service->delete_asset( $event_date, (int) $request['asset_id'] );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response(
			array(
				'deleted'  => true,
				'previous' => $result,
			),
			200
		);
	}

	/**
	 * The submitted write fields, leaving out those not sent.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return array
	 */
	private function submitted( $request ) {
		$params = array();
		foreach ( array( 'label', 'text', 'attachment_id', 'member_ids', 'schedule_item_id' ) as $key ) {
			if ( $request->has_param( $key ) ) {
				$params[ $key ] = $request->get_param( $key );
			}
		}
		return $params;
	}

	/**
	 * The requested event date, or a 404.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return EventDates|WP_Error
	 */
	private function event_date( $request ) {
		$event_date = EventDates::get_by_id( (int) $request['event_date_id'] );
		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events-experimental' ),
				array( 'status' => 404 )
			);
		}
		return $event_date;
	}

	/**
	 * Error for a user who may not manage this event's marketing assets.
	 *
	 * @return WP_Error
	 */
	private function forbidden() {
		return new WP_Error(
			'rest_forbidden',
			__( 'You do not have permission to manage this event\'s marketing assets.', 'fair-events-experimental' ),
			array( 'status' => 403 )
		);
	}
}
