<?php
/**
 * REST API Controller for Group Pricing Rules
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairEvents\Models\GroupPricingRule;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles group pricing rules REST API endpoints
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class GroupPricingRulesController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Register the routes for group pricing rules
	 *
	 * @return void
	 */
	public function register_routes() {
		// Only register if fair-audience plugin is active.
		if ( ! defined( 'FAIR_AUDIENCE_PLUGIN_DIR' ) ) {
			return;
		}

		// GET + POST /fair-events/v1/event-dates/{id}/group-pricing-rules.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/group-pricing-rules',
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
						'id'             => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
						'group_id'       => array(
							'description'       => __( 'Group ID.', 'fair-events' ),
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'discount_type'  => array(
							'description'       => __( 'Discount type.', 'fair-events' ),
							'type'              => 'string',
							'required'          => true,
							'enum'              => array( 'percentage', 'amount' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
						'discount_value' => array(
							'description'       => __( 'Discount value.', 'fair-events' ),
							'type'              => 'number',
							'required'          => true,
							'sanitize_callback' => function ( $value ) {
								return floatval( $value );
							},
						),
					),
				),
			)
		);

		// PUT + DELETE /fair-events/v1/event-dates/{id}/group-pricing-rules/{rule_id}.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/group-pricing-rules/(?P<rule_id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'items_permissions_check' ),
					'args'                => array(
						'id'             => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
						'rule_id'        => array(
							'description' => __( 'Rule ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
						'discount_type'  => array(
							'description'       => __( 'Discount type.', 'fair-events' ),
							'type'              => 'string',
							'enum'              => array( 'percentage', 'amount' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
						'discount_value' => array(
							'description'       => __( 'Discount value.', 'fair-events' ),
							'type'              => 'number',
							'sanitize_callback' => function ( $value ) {
								return floatval( $value );
							},
						),
					),
				),
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
	 * Check permissions for group pricing rule operations
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function items_permissions_check( $request ) {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * List group pricing rules for an event date
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

		$rules = GroupPricingRule::get_all_by_event_date_id( $event_date_id );

		$data = array();
		foreach ( $rules as $rule ) {
			$item               = $rule->to_array();
			$item['group_name'] = $this->get_group_name( $rule->group_id );
			$data[]             = $item;
		}

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Create a group pricing rule
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

		$group_id       = (int) $request->get_param( 'group_id' );
		$discount_type  = $request->get_param( 'discount_type' );
		$discount_value = (float) $request->get_param( 'discount_value' );

		$rule_id = GroupPricingRule::create( $event_date_id, $group_id, $discount_type, $discount_value );

		if ( ! $rule_id ) {
			return new WP_Error(
				'rest_create_failed',
				__( 'Failed to create pricing rule. The group may already have a rule for this event.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$rule               = GroupPricingRule::get_by_id( $rule_id );
		$data               = $rule->to_array();
		$data['group_name'] = $this->get_group_name( $rule->group_id );

		return new WP_REST_Response( $data, 201 );
	}

	/**
	 * Update a group pricing rule
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function update_item( $request ) {
		$event_date_id = (int) $request->get_param( 'id' );
		$rule_id       = (int) $request->get_param( 'rule_id' );

		$rule = GroupPricingRule::get_by_id( $rule_id );

		if ( ! $rule || $rule->event_date_id !== $event_date_id ) {
			return new WP_Error(
				'rest_rule_not_found',
				__( 'Pricing rule not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$update_data = array();

		$discount_type = $request->get_param( 'discount_type' );
		if ( null !== $discount_type ) {
			$update_data['discount_type'] = $discount_type;
		}

		$discount_value = $request->get_param( 'discount_value' );
		if ( null !== $discount_value ) {
			$update_data['discount_value'] = (float) $discount_value;
		}

		if ( empty( $update_data ) ) {
			return new WP_Error(
				'rest_no_data',
				__( 'No data to update.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$success = GroupPricingRule::update( $rule_id, $update_data );

		if ( ! $success ) {
			return new WP_Error(
				'rest_update_failed',
				__( 'Failed to update pricing rule.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		$updated_rule       = GroupPricingRule::get_by_id( $rule_id );
		$data               = $updated_rule->to_array();
		$data['group_name'] = $this->get_group_name( $updated_rule->group_id );

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Delete a group pricing rule
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function delete_item( $request ) {
		$event_date_id = (int) $request->get_param( 'id' );
		$rule_id       = (int) $request->get_param( 'rule_id' );

		$rule = GroupPricingRule::get_by_id( $rule_id );

		if ( ! $rule || $rule->event_date_id !== $event_date_id ) {
			return new WP_Error(
				'rest_rule_not_found',
				__( 'Pricing rule not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$success = GroupPricingRule::delete( $rule_id );

		if ( ! $success ) {
			return new WP_Error(
				'rest_delete_failed',
				__( 'Failed to delete pricing rule.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response( null, 204 );
	}

	/**
	 * Get group name from fair_audience_groups table
	 *
	 * @param int $group_id Group ID.
	 * @return string Group name or empty string.
	 */
	private function get_group_name( $group_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_groups';

		$name = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT name FROM %i WHERE id = %d',
				$table_name,
				$group_id
			)
		);

		return $name ? $name : '';
	}
}
