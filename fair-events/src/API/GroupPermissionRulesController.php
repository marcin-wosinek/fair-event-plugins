<?php
/**
 * REST API Controller for Group Permission Rules
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairEvents\Models\GroupPermissionRule;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles group permission rules REST API endpoints
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class GroupPermissionRulesController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Valid permission types
	 *
	 * @var array
	 */
	const VALID_PERMISSION_TYPES = array( 'view_signups', 'manage_signups' );

	/**
	 * Register the routes for group permission rules
	 *
	 * @return void
	 */
	public function register_routes() {
		// Only register if fair-audience plugin is active.
		if ( ! defined( 'FAIR_AUDIENCE_PLUGIN_DIR' ) ) {
			return;
		}

		// GET + POST /fair-events/v1/event-dates/{id}/group-permission-rules.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/group-permission-rules',
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
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'items_permissions_check' ),
					'args'                => array(
						'id'              => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
						'group_id'        => array(
							'description'       => __( 'Group ID.', 'fair-events' ),
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'permission_type' => array(
							'description'       => __( 'Permission type.', 'fair-events' ),
							'type'              => 'string',
							'required'          => true,
							'enum'              => self::VALID_PERMISSION_TYPES,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// DELETE /fair-events/v1/event-dates/{id}/group-permission-rules/{rule_id}.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/group-permission-rules/(?P<rule_id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'items_permissions_check' ),
					'args'                => array(
						'id'      => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
						'rule_id' => array(
							'description' => __( 'Rule ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Check permissions for group permission rule operations
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function items_permissions_check( $request ) {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * List group permission rules for an event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function get_items( $request ) {
		$event_date_id = (int) $request->get_param( 'id' );
		$event_date    = EventDates::get_by_id( $event_date_id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$rules = GroupPermissionRule::get_all_by_event_date_id( $event_date_id );

		$data = array();
		foreach ( $rules as $rule ) {
			$data[] = $rule->to_array();
		}

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Create a group permission rule
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function create_item( $request ) {
		$event_date_id = (int) $request->get_param( 'id' );
		$event_date    = EventDates::get_by_id( $event_date_id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$group_id        = (int) $request->get_param( 'group_id' );
		$permission_type = $request->get_param( 'permission_type' );

		$rule_id = GroupPermissionRule::create( $event_date_id, $group_id, $permission_type );

		if ( ! $rule_id ) {
			return new WP_Error(
				'rest_create_failed',
				__( 'Failed to create permission rule. The group may already have this permission for this event.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$rule = GroupPermissionRule::get_by_id( $rule_id );

		return new WP_REST_Response( $rule->to_array(), 201 );
	}

	/**
	 * Delete a group permission rule
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function delete_item( $request ) {
		$event_date_id = (int) $request->get_param( 'id' );
		$rule_id       = (int) $request->get_param( 'rule_id' );

		$rule = GroupPermissionRule::get_by_id( $rule_id );

		if ( ! $rule || $rule->event_date_id !== $event_date_id ) {
			return new WP_Error(
				'rest_rule_not_found',
				__( 'Permission rule not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$success = GroupPermissionRule::delete( $rule_id );

		if ( ! $success ) {
			return new WP_Error(
				'rest_delete_failed',
				__( 'Failed to delete permission rule.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response( null, 204 );
	}
}
