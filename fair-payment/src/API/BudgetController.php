<?php
/**
 * REST API Controller for Budgets
 *
 * @package FairPayment
 */

namespace FairPayment\API;

defined( 'WPINC' ) || die;

use FairPayment\Models\Budget;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles budget REST API endpoints
 */
class BudgetController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payment/v1';

	/**
	 * Register the routes for budgets
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-payment/v1/budgets - Get all budgets.
		// POST /fair-payment/v1/budgets - Create budget.
		register_rest_route(
			$this->namespace,
			'/budgets',
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

		// GET /fair-payment/v1/budgets/{id} - Get single budget.
		// PUT /fair-payment/v1/budgets/{id} - Update budget.
		// DELETE /fair-payment/v1/budgets/{id} - Delete budget.
		register_rest_route(
			$this->namespace,
			'/budgets/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the budget.', 'fair-payment' ),
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
							'description' => __( 'Unique identifier for the budget.', 'fair-payment' ),
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
			'name'        => array(
				'description'       => __( 'Budget name.', 'fair-payment' ),
				'type'              => 'string',
				'required'          => true,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'description' => array(
				'description'       => __( 'Budget description.', 'fair-payment' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'sanitize_textarea_field',
			),
		);
	}

	/**
	 * Get all budgets
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_items( $request ) {
		$budgets = Budget::get_all();

		$data = array_map(
			function ( $budget ) {
				return $budget->to_array();
			},
			$budgets
		);

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Get single budget
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_item( $request ) {
		$id     = (int) $request->get_param( 'id' );
		$budget = Budget::get_by_id( $id );

		if ( ! $budget ) {
			return new WP_Error(
				'rest_budget_not_found',
				__( 'Budget not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $budget->to_array(), 200 );
	}

	/**
	 * Create new budget
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_item( $request ) {
		$name        = $request->get_param( 'name' );
		$description = $request->get_param( 'description' );

		if ( empty( $name ) ) {
			return new WP_Error(
				'rest_invalid_name',
				__( 'Budget name is required.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$budget_id = Budget::create( $name, $description );

		if ( ! $budget_id ) {
			return new WP_Error(
				'rest_budget_creation_failed',
				__( 'Failed to create budget.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		$budget = Budget::get_by_id( $budget_id );

		return new WP_REST_Response( $budget->to_array(), 201 );
	}

	/**
	 * Update budget
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function update_item( $request ) {
		$id          = (int) $request->get_param( 'id' );
		$name        = $request->get_param( 'name' );
		$description = $request->get_param( 'description' );

		// Check if budget exists.
		$existing = Budget::get_by_id( $id );
		if ( ! $existing ) {
			return new WP_Error(
				'rest_budget_not_found',
				__( 'Budget not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		if ( empty( $name ) ) {
			return new WP_Error(
				'rest_invalid_name',
				__( 'Budget name is required.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$success = Budget::update( $id, $name, $description );

		if ( ! $success ) {
			return new WP_Error(
				'rest_budget_update_failed',
				__( 'Failed to update budget.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		$budget = Budget::get_by_id( $id );

		return new WP_REST_Response( $budget->to_array(), 200 );
	}

	/**
	 * Delete budget
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function delete_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		// Check if budget exists.
		$existing = Budget::get_by_id( $id );
		if ( ! $existing ) {
			return new WP_Error(
				'rest_budget_not_found',
				__( 'Budget not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		$success = Budget::delete( $id );

		if ( ! $success ) {
			return new WP_Error(
				'rest_budget_delete_failed',
				__( 'Failed to delete budget.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted' => true,
				'budget'  => $existing->to_array(),
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
