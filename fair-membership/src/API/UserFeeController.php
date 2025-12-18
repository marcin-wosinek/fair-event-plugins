<?php
/**
 * UserFee REST API Controller for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\API;

use FairMembership\Models\UserFee;
use FairMembership\Models\UserFeeAdjustment;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * UserFee REST API Controller
 */
class UserFeeController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-membership/v1';

	/**
	 * REST base for user fees
	 *
	 * @var string
	 */
	protected $rest_base = 'user-fees';

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-membership/v1/user-fees - List all user fees
		// POST /fair-membership/v1/user-fees - Create individual user fee
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'user_id'      => array(
							'description' => __( 'Filter by user ID.', 'fair-membership' ),
							'type'        => 'integer',
						),
						'group_fee_id' => array(
							'description' => __( 'Filter by group fee ID.', 'fair-membership' ),
							'type'        => 'integer',
						),
						'status'       => array(
							'description' => __( 'Filter by status.', 'fair-membership' ),
							'type'        => 'string',
							'enum'        => array( 'pending', 'paid', 'cancelled', 'overdue' ),
						),
						'page'         => array(
							'description' => __( 'Page number.', 'fair-membership' ),
							'type'        => 'integer',
							'default'     => 1,
						),
						'per_page'     => array(
							'description' => __( 'Items per page.', 'fair-membership' ),
							'type'        => 'integer',
							'default'     => 20,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'user_id'  => array(
							'required' => true,
							'type'     => 'integer',
						),
						'title'    => array(
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'amount'   => array(
							'required' => true,
							'type'     => 'number',
							'minimum'  => 0,
						),
						'due_date' => array(
							'required' => true,
							'type'     => 'string',
							'format'   => 'date',
						),
						'notes'    => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_textarea_field',
						),
					),
				),
			)
		);

		// GET /fair-membership/v1/user-fees/{id} - Get single user fee
		// PUT /fair-membership/v1/user-fees/{id} - Update user fee
		// DELETE /fair-membership/v1/user-fees/{id} - Delete user fee
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)',
			array(
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
						'amount'   => array(
							'type'    => 'number',
							'minimum' => 0,
						),
						'due_date' => array(
							'type'   => 'string',
							'format' => 'date',
						),
						'status'   => array(
							'type' => 'string',
							'enum' => array( 'pending', 'paid', 'cancelled', 'overdue' ),
						),
						'notes'    => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_textarea_field',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
				),
			)
		);

		// POST /fair-membership/v1/user-fees/{id}/adjust - Adjust amount with audit trail
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/adjust',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'adjust_amount' ),
				'permission_callback' => array( $this, 'update_item_permissions_check' ),
				'args'                => array(
					'new_amount' => array(
						'required' => true,
						'type'     => 'number',
						'minimum'  => 0,
					),
					'reason'     => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_textarea_field',
					),
				),
			)
		);

		// POST /fair-membership/v1/user-fees/{id}/pay - Mark as paid
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/pay',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'mark_as_paid' ),
				'permission_callback' => array( $this, 'update_item_permissions_check' ),
			)
		);

		// GET /fair-membership/v1/user-fees/{id}/adjustments - Get adjustment history
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/adjustments',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_adjustments' ),
				'permission_callback' => array( $this, 'get_item_permissions_check' ),
			)
		);

		// POST /fair-membership/v1/user-fees/{id}/create-payment - Create payment transaction
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/create-payment',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'create_payment' ),
				'permission_callback' => array( $this, 'create_payment_permissions_check' ),
				'args'                => array(
					'redirect_url' => array(
						'type'              => 'string',
						'sanitize_callback' => 'esc_url_raw',
						'description'       => __( 'URL to redirect after payment.', 'fair-membership' ),
					),
				),
			)
		);
	}

	/**
	 * Check permissions for getting items
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function get_items_permissions_check( $request ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to view user fees.', 'fair-membership' ),
				array( 'status' => 403 )
			);
		}
		return true;
	}

	/**
	 * Check permissions for creating item
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function create_item_permissions_check( $request ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to create user fees.', 'fair-membership' ),
				array( 'status' => 403 )
			);
		}
		return true;
	}

	/**
	 * Check permissions for getting single item
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function get_item_permissions_check( $request ) {
		return $this->get_items_permissions_check( $request );
	}

	/**
	 * Check permissions for updating item
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function update_item_permissions_check( $request ) {
		return $this->create_item_permissions_check( $request );
	}

	/**
	 * Check permissions for deleting item
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function delete_item_permissions_check( $request ) {
		return $this->create_item_permissions_check( $request );
	}

	/**
	 * Check permissions for creating payment
	 * Users can create payments for their own fees
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function create_payment_permissions_check( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in to create payments.', 'fair-membership' ),
				array( 'status' => 401 )
			);
		}

		$fee_id   = $request->get_param( 'id' );
		$user_fee = UserFee::get_by_id( $fee_id );

		if ( ! $user_fee ) {
			return new WP_Error(
				'not_found',
				__( 'User fee not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Users can only create payments for their own fees
		if ( $user_fee->user_id !== get_current_user_id() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You can only create payments for your own fees.', 'fair-membership' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Enrich user fee with user information
	 *
	 * @param UserFee $user_fee User fee object.
	 * @return array Enriched user fee array.
	 */
	private function enrich_user_fee( $user_fee ) {
		$fee_array = $user_fee->to_array();

		// Add user information if user exists
		if ( $user_fee->user_id ) {
			$user = get_userdata( $user_fee->user_id );
			if ( $user ) {
				$fee_array['user_display_name'] = $user->display_name;
				$fee_array['user_email']        = $user->user_email;
			}
		}

		return $fee_array;
	}

	/**
	 * Get user fees
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_items( $request ) {
		$page         = $request->get_param( 'page' );
		$per_page     = $request->get_param( 'per_page' );
		$user_id      = $request->get_param( 'user_id' );
		$group_fee_id = $request->get_param( 'group_fee_id' );
		$status       = $request->get_param( 'status' );

		$args = array(
			'user_id'      => $user_id,
			'group_fee_id' => $group_fee_id,
			'status'       => $status,
			'limit'        => $per_page,
			'offset'       => ( $page - 1 ) * $per_page,
		);

		$user_fees = UserFee::get_all( $args );
		$total     = UserFee::get_count( $args );

		// Enrich with user information
		$enriched_fees = array();
		foreach ( $user_fees as $user_fee ) {
			$enriched_fees[] = $this->enrich_user_fee( $user_fee );
		}

		$response = new WP_REST_Response( $enriched_fees );
		$response->header( 'X-WP-Total', $total );
		$response->header( 'X-WP-TotalPages', ceil( $total / $per_page ) );

		return $response;
	}

	/**
	 * Create individual user fee (not linked to group fee)
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$user_fee               = new UserFee();
		$user_fee->group_fee_id = null; // Individual fee
		$user_fee->user_id      = $request->get_param( 'user_id' );
		$user_fee->title        = $request->get_param( 'title' );
		$user_fee->amount       = $request->get_param( 'amount' );
		$user_fee->due_date     = $request->get_param( 'due_date' );
		$user_fee->status       = 'pending';
		$user_fee->notes        = $request->get_param( 'notes' );

		// Validate
		$validation = $user_fee->validate();
		if ( is_wp_error( $validation ) ) {
			return $validation;
		}

		// Save
		$result = $user_fee->save();
		if ( ! $result ) {
			return new WP_Error(
				'save_failed',
				__( 'Failed to save user fee.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response( $this->enrich_user_fee( $user_fee ), 201 );
	}

	/**
	 * Get single user fee
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		$id       = $request->get_param( 'id' );
		$user_fee = UserFee::get_by_id( $id );

		if ( ! $user_fee ) {
			return new WP_Error(
				'not_found',
				__( 'User fee not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $this->enrich_user_fee( $user_fee ) );
	}

	/**
	 * Update user fee
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$id       = $request->get_param( 'id' );
		$user_fee = UserFee::get_by_id( $id );

		if ( ! $user_fee ) {
			return new WP_Error(
				'not_found',
				__( 'User fee not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Check if fee is already paid
		if ( 'paid' === $user_fee->status ) {
			return new WP_Error(
				'already_paid',
				__( 'Cannot edit paid fees.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		// Update fields if provided
		if ( $request->has_param( 'amount' ) ) {
			$user_fee->amount = $request->get_param( 'amount' );
		}
		if ( $request->has_param( 'due_date' ) ) {
			$user_fee->due_date = $request->get_param( 'due_date' );
		}
		if ( $request->has_param( 'status' ) ) {
			$user_fee->status = $request->get_param( 'status' );
		}
		if ( $request->has_param( 'notes' ) ) {
			$user_fee->notes = $request->get_param( 'notes' );
		}

		// Validate
		$validation = $user_fee->validate();
		if ( is_wp_error( $validation ) ) {
			return $validation;
		}

		// Save
		$result = $user_fee->save();
		if ( ! $result ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update user fee.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response( $this->enrich_user_fee( $user_fee ) );
	}

	/**
	 * Delete user fee
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$id       = $request->get_param( 'id' );
		$user_fee = UserFee::get_by_id( $id );

		if ( ! $user_fee ) {
			return new WP_Error(
				'not_found',
				__( 'User fee not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Check if fee is already paid
		if ( 'paid' === $user_fee->status ) {
			return new WP_Error(
				'already_paid',
				__( 'Cannot delete paid fees.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		$result = $user_fee->delete();
		if ( ! $result ) {
			return new WP_Error(
				'delete_failed',
				__( 'Failed to delete user fee.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted' => true,
				'id'      => $id,
			)
		);
	}

	/**
	 * Adjust user fee amount with audit trail
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function adjust_amount( $request ) {
		$id         = $request->get_param( 'id' );
		$new_amount = $request->get_param( 'new_amount' );
		$reason     = $request->get_param( 'reason' );

		$user_fee = UserFee::get_by_id( $id );

		if ( ! $user_fee ) {
			return new WP_Error(
				'not_found',
				__( 'User fee not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Check if fee is already paid
		if ( 'paid' === $user_fee->status ) {
			return new WP_Error(
				'already_paid',
				__( 'Cannot adjust amount for paid fees.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		$previous_amount = $user_fee->amount;

		// Create adjustment record
		$adjustment_id = UserFeeAdjustment::create(
			$user_fee->id,
			$previous_amount,
			$new_amount,
			$reason,
			get_current_user_id()
		);

		if ( ! $adjustment_id ) {
			return new WP_Error(
				'adjustment_failed',
				__( 'Failed to create adjustment record.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}

		// Update user fee amount
		$user_fee->amount = $new_amount;
		$result           = $user_fee->save();

		if ( ! $result ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update user fee amount.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'user_fee'      => $this->enrich_user_fee( $user_fee ),
				'adjustment_id' => $adjustment_id,
			)
		);
	}

	/**
	 * Mark user fee as paid
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function mark_as_paid( $request ) {
		$id       = $request->get_param( 'id' );
		$user_fee = UserFee::get_by_id( $id );

		if ( ! $user_fee ) {
			return new WP_Error(
				'not_found',
				__( 'User fee not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		$result = $user_fee->mark_as_paid();

		if ( ! $result ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to mark fee as paid.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response( $this->enrich_user_fee( $user_fee ) );
	}

	/**
	 * Get adjustment history for a user fee
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_adjustments( $request ) {
		$id       = $request->get_param( 'id' );
		$user_fee = UserFee::get_by_id( $id );

		if ( ! $user_fee ) {
			return new WP_Error(
				'not_found',
				__( 'User fee not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		$adjustments = UserFeeAdjustment::get_by_user_fee( $id );

		return new WP_REST_Response( $adjustments );
	}

	/**
	 * Create payment transaction for a user fee
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_payment( $request ) {
		$id           = $request->get_param( 'id' );
		$redirect_url = $request->get_param( 'redirect_url' );
		$user_fee     = UserFee::get_by_id( $id );

		if ( ! $user_fee ) {
			return new WP_Error(
				'not_found',
				__( 'User fee not found.', 'fair-membership' ),
				array( 'status' => 404 )
			);
		}

		// Check if fee is payable (pending or overdue)
		if ( ! in_array( $user_fee->status, array( 'pending', 'overdue' ), true ) ) {
			return new WP_Error(
				'invalid_status',
				__( 'Only pending or overdue fees can be paid.', 'fair-membership' ),
				array( 'status' => 400 )
			);
		}

		// Check if fair-payment plugin is available
		if ( ! function_exists( 'fair_payment_create_transaction' ) || ! function_exists( 'fair_payment_initiate_payment' ) ) {
			return new WP_Error(
				'payment_unavailable',
				__( 'Payment system is not available.', 'fair-membership' ),
				array( 'status' => 503 )
			);
		}

		// Create transaction
		$transaction_id = fair_payment_create_transaction(
			array(
				array(
					'name'     => $user_fee->title,
					'quantity' => 1,
					'amount'   => $user_fee->amount,
				),
			),
			array(
				'currency'    => 'EUR',
				'description' => sprintf(
					/* translators: %s: fee title */
					__( 'Payment for: %s', 'fair-membership' ),
					$user_fee->title
				),
				'user_id'     => $user_fee->user_id,
				'metadata'    => array(
					'user_fee_id' => $user_fee->id,
					'plugin'      => 'fair-membership',
				),
			)
		);

		if ( is_wp_error( $transaction_id ) ) {
			return new WP_Error(
				'transaction_failed',
				sprintf(
					/* translators: %s: error message */
					__( 'Failed to create transaction: %s', 'fair-membership' ),
					$transaction_id->get_error_message()
				),
				array( 'status' => 500 )
			);
		}

		// Initiate payment
		$payment_args = array();
		if ( $redirect_url ) {
			$payment_args['redirect_url'] = $redirect_url;
		}

		$payment = fair_payment_initiate_payment( $transaction_id, $payment_args );

		if ( is_wp_error( $payment ) ) {
			return new WP_Error(
				'payment_initiation_failed',
				sprintf(
					/* translators: %s: error message */
					__( 'Failed to initiate payment: %s', 'fair-membership' ),
					$payment->get_error_message()
				),
				array( 'status' => 500 )
			);
		}

		if ( ! isset( $payment['checkout_url'] ) ) {
			return new WP_Error(
				'invalid_payment_response',
				__( 'Payment response does not contain checkout URL.', 'fair-membership' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'transaction_id' => $transaction_id,
				'checkout_url'   => $payment['checkout_url'],
				'user_fee'       => $user_fee->to_array(),
			)
		);
	}
}
