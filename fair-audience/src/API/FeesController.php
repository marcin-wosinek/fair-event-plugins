<?php
/**
 * Fees REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\FeeRepository;
use FairAudience\Database\FeePaymentRepository;
use FairAudience\Database\FeeAuditLogRepository;
use FairAudience\Models\Fee;
use FairAudience\Services\EmailService;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for membership fees.
 */
class FeesController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-audience/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'fees';

	/**
	 * Fee repository instance.
	 *
	 * @var FeeRepository
	 */
	private $fee_repository;

	/**
	 * Fee payment repository instance.
	 *
	 * @var FeePaymentRepository
	 */
	private $payment_repository;

	/**
	 * Fee audit log repository instance.
	 *
	 * @var FeeAuditLogRepository
	 */
	private $audit_log_repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->fee_repository       = new FeeRepository();
		$this->payment_repository   = new FeePaymentRepository();
		$this->audit_log_repository = new FeeAuditLogRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fees, POST /fees.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => 'is_user_logged_in',
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
				),
			)
		);

		// GET /fees/{id}, PUT /fees/{id}, DELETE /fees/{id}.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => 'is_user_logged_in',
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
				),
			)
		);

		// GET /fees/{id}/payments.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/payments',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_payments' ),
					'permission_callback' => 'is_user_logged_in',
				),
			)
		);

		// PUT /fees/{id}/payments/{pid}/amount.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/payments/(?P<pid>\d+)/amount',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'adjust_payment_amount' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
				),
			)
		);

		// POST /fees/{id}/payments/{pid}/mark-paid.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/payments/(?P<pid>\d+)/mark-paid',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'mark_payment_paid' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
				),
			)
		);

		// POST /fees/{id}/payments/{pid}/cancel.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/payments/(?P<pid>\d+)/cancel',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'cancel_payment' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
				),
			)
		);

		// GET /fees/{id}/payments/{pid}/audit-log.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/payments/(?P<pid>\d+)/audit-log',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_payment_audit_log' ),
					'permission_callback' => 'is_user_logged_in',
				),
			)
		);

		// GET /fees/{id}/audit-log.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/audit-log',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_fee_audit_log' ),
					'permission_callback' => 'is_user_logged_in',
				),
			)
		);

		// POST /fees/{id}/send-reminders.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/send-reminders',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'send_reminders' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
				),
			)
		);
	}

	/**
	 * Get all fees.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_items( $request ) {
		$orderby = $request->get_param( 'orderby' ) ?? 'created_at';
		$order   = $request->get_param( 'order' ) ?? 'DESC';

		$fees  = $this->fee_repository->get_all_with_summary( $orderby, $order );
		$total = count( $fees );

		$response = rest_ensure_response( $fees );
		$response->header( 'X-WP-Total', $total );

		return $response;
	}

	/**
	 * Get single fee.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_item( $request ) {
		$id   = $request->get_param( 'id' );
		$data = $this->fee_repository->get_by_id_with_group( $id );

		if ( ! $data ) {
			return new WP_Error(
				'fee_not_found',
				__( 'Fee not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		return rest_ensure_response( $data );
	}

	/**
	 * Create fee.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$name     = $request->get_param( 'name' );
		$group_id = $request->get_param( 'group_id' );
		$amount   = $request->get_param( 'amount' );

		if ( empty( $name ) ) {
			return new WP_Error(
				'missing_name',
				__( 'Fee name is required.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		if ( empty( $group_id ) ) {
			return new WP_Error(
				'missing_group',
				__( 'Group is required.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		if ( ! is_numeric( $amount ) || $amount <= 0 ) {
			return new WP_Error(
				'invalid_amount',
				__( 'Amount must be a positive number.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$fee = new Fee();
		$fee->populate(
			array(
				'name'        => $name,
				'description' => $request->get_param( 'description' ) ?? '',
				'group_id'    => $group_id,
				'amount'      => $amount,
				'currency'    => $request->get_param( 'currency' ) ?? 'EUR',
				'due_date'    => $request->get_param( 'due_date' ) ?? '',
				'status'      => $request->get_param( 'status' ) ?? 'active',
				'created_by'  => get_current_user_id(),
			)
		);

		if ( ! $fee->save() ) {
			return new WP_Error(
				'creation_failed',
				__( 'Failed to create fee.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Generate fee_payment records for all group members.
		$created = $this->payment_repository->create_payments_for_group( $fee->id, $group_id, $amount );

		return rest_ensure_response(
			array(
				'id'               => $fee->id,
				'payments_created' => $created,
				'message'          => __( 'Fee created successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Update fee.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function update_item( $request ) {
		$id  = $request->get_param( 'id' );
		$fee = $this->fee_repository->get_by_id( $id );

		if ( ! $fee ) {
			return new WP_Error(
				'fee_not_found',
				__( 'Fee not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$fee->populate(
			array(
				'id'          => $fee->id,
				'name'        => $request->get_param( 'name' ) ?? $fee->name,
				'description' => $request->get_param( 'description' ) ?? $fee->description,
				'group_id'    => $fee->group_id,
				'amount'      => $fee->amount,
				'currency'    => $fee->currency,
				'due_date'    => $request->get_param( 'due_date' ) ?? $fee->due_date,
				'status'      => $request->get_param( 'status' ) ?? $fee->status,
				'created_by'  => $fee->created_by,
			)
		);

		if ( ! $fee->save() ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update fee.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'id'      => $fee->id,
				'message' => __( 'Fee updated successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Delete fee.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function delete_item( $request ) {
		$id  = $request->get_param( 'id' );
		$fee = $this->fee_repository->get_by_id( $id );

		if ( ! $fee ) {
			return new WP_Error(
				'fee_not_found',
				__( 'Fee not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		if ( ! $fee->delete() ) {
			return new WP_Error(
				'deletion_failed',
				__( 'Failed to delete fee.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'message' => __( 'Fee deleted successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Get payments for a fee.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_payments( $request ) {
		$fee_id = $request->get_param( 'id' );
		$fee    = $this->fee_repository->get_by_id( $fee_id );

		if ( ! $fee ) {
			return new WP_Error(
				'fee_not_found',
				__( 'Fee not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$payments = $this->payment_repository->get_by_fee_with_participant_details( $fee_id );

		return rest_ensure_response( $payments );
	}

	/**
	 * Adjust payment amount.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function adjust_payment_amount( $request ) {
		$payment = $this->get_validated_payment( $request );
		if ( is_wp_error( $payment ) ) {
			return $payment;
		}

		$new_amount = $request->get_param( 'amount' );
		$comment    = $request->get_param( 'comment' );

		if ( ! is_numeric( $new_amount ) || $new_amount < 0 ) {
			return new WP_Error(
				'invalid_amount',
				__( 'Amount must be a non-negative number.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		if ( empty( $comment ) ) {
			return new WP_Error(
				'missing_comment',
				__( 'A reason for the adjustment is required.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$old_amount      = $payment->amount;
		$payment->amount = $new_amount;

		if ( ! $payment->save() ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update payment amount.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Log the adjustment.
		$this->audit_log_repository->log_action(
			$payment->id,
			'amount_adjusted',
			$old_amount,
			$new_amount,
			$comment
		);

		return rest_ensure_response(
			array(
				'message' => __( 'Payment amount adjusted successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Mark payment as paid.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function mark_payment_paid( $request ) {
		$payment = $this->get_validated_payment( $request );
		if ( is_wp_error( $payment ) ) {
			return $payment;
		}

		$old_status       = $payment->status;
		$payment->status  = 'paid';
		$payment->paid_at = current_time( 'mysql' );

		if ( ! $payment->save() ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to mark payment as paid.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Log the action.
		$this->audit_log_repository->log_action(
			$payment->id,
			'marked_paid',
			$old_status,
			'paid'
		);

		return rest_ensure_response(
			array(
				'message' => __( 'Payment marked as paid.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Cancel payment.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function cancel_payment( $request ) {
		$payment = $this->get_validated_payment( $request );
		if ( is_wp_error( $payment ) ) {
			return $payment;
		}

		$old_status      = $payment->status;
		$payment->status = 'canceled';

		if ( ! $payment->save() ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to cancel payment.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Log the action.
		$this->audit_log_repository->log_action(
			$payment->id,
			'marked_canceled',
			$old_status,
			'canceled'
		);

		return rest_ensure_response(
			array(
				'message' => __( 'Payment canceled.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Get audit log for a specific payment.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_payment_audit_log( $request ) {
		$payment = $this->get_validated_payment( $request );
		if ( is_wp_error( $payment ) ) {
			return $payment;
		}

		$entries = $this->audit_log_repository->get_by_fee_payment_id( $payment->id );

		return rest_ensure_response( $entries );
	}

	/**
	 * Get audit log for entire fee.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_fee_audit_log( $request ) {
		$fee_id = $request->get_param( 'id' );
		$fee    = $this->fee_repository->get_by_id( $fee_id );

		if ( ! $fee ) {
			return new WP_Error(
				'fee_not_found',
				__( 'Fee not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$entries = $this->audit_log_repository->get_by_fee_id( $fee_id );

		return rest_ensure_response( $entries );
	}

	/**
	 * Send reminders for pending payments.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function send_reminders( $request ) {
		$fee_id = $request->get_param( 'id' );
		$fee    = $this->fee_repository->get_by_id( $fee_id );

		if ( ! $fee ) {
			return new WP_Error(
				'fee_not_found',
				__( 'Fee not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$email_service = new EmailService();
		$results       = $email_service->send_bulk_fee_reminders( $fee_id );

		return rest_ensure_response( $results );
	}

	/**
	 * Validate and return a fee payment from request params.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return \FairAudience\Models\FeePayment|WP_Error Payment or error.
	 */
	private function get_validated_payment( $request ) {
		$fee_id     = $request->get_param( 'id' );
		$payment_id = $request->get_param( 'pid' );

		$fee = $this->fee_repository->get_by_id( $fee_id );
		if ( ! $fee ) {
			return new WP_Error(
				'fee_not_found',
				__( 'Fee not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$payment = $this->payment_repository->get_by_id( $payment_id );
		if ( ! $payment || $payment->fee_id !== (int) $fee_id ) {
			return new WP_Error(
				'payment_not_found',
				__( 'Payment not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		return $payment;
	}

	/**
	 * Check permissions for creating.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function create_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for updating.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function update_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for deleting.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function delete_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
