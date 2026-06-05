<?php
/**
 * Payment REST API Endpoint
 *
 * @package FairPayment
 */

namespace FairPayment\API;

use FairPayment\Payment\MolliePaymentHandler;
use FairPayment\Models\Transaction;
use FairPayment\Database\PaymentLogRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Class for handling payment REST API endpoints
 */
class PaymentEndpoint extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payment/v1';

	/**
	 * Resource name
	 *
	 * @var string
	 */
	protected $rest_base = 'payments';

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_payment' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'amount'      => array(
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'currency'    => array(
							'required'          => false,
							'type'              => 'string',
							'default'           => 'EUR',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'description' => array(
							'required'          => false,
							'type'              => 'string',
							'default'           => '',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'post_id'     => array(
							'required'          => false,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<transaction_id>\d+)/status',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_transaction_status' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'transaction_id' => array(
							'required'          => true,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);
	}

	/**
	 * Create a new payment
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_payment( WP_REST_Request $request ) {
		// TODO: Implement different behavior for logged-in vs anonymous users.
		// - Logged-in users: Track in user profile.
		// - Anonymous users: Require email.
		// See: REST_API_BACKEND.md for implementation guidance.

		$logger = new PaymentLogRepository();

		$amount      = $request->get_param( 'amount' );
		$currency    = $request->get_param( 'currency' );
		$description = $request->get_param( 'description' );
		$post_id     = $request->get_param( 'post_id' );

		$logger->log(
			'payment_creation_started',
			array(
				'level'   => 'info',
				'message' => sprintf( 'Payment request received for post %d', (int) $post_id ),
				'context' => array(
					'amount'      => $amount,
					'currency'    => $currency,
					'description' => $description,
					'post_id'     => $post_id,
				),
			)
		);

		// Check if Mollie is configured.
		if ( ! MolliePaymentHandler::is_configured() ) {
			$logger->log(
				'payment_validation_failed',
				array(
					'level'   => 'warning',
					'message' => 'Mollie not configured',
					'context' => array( 'reason' => 'mollie_not_configured' ),
				)
			);
			return new WP_Error(
				'mollie_not_configured',
				__( 'Mollie payment gateway is not configured. Please configure your API keys in settings.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		// Validate amount.
		if ( ! is_numeric( $amount ) || $amount <= 0 ) {
			$logger->log(
				'payment_validation_failed',
				array(
					'level'   => 'warning',
					'message' => 'Invalid payment amount',
					'context' => array(
						'reason' => 'invalid_amount',
						'amount' => $amount,
					),
				)
			);
			return new WP_Error(
				'invalid_amount',
				__( 'Invalid payment amount.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		// Prepare description.
		$final_description = ! empty( $description ) ? $description : sprintf(
			/* translators: %s: amount and currency */
			__( 'Payment of %1$s %2$s', 'fair-payment' ),
			$amount,
			$currency
		);

		// Create transaction with single line item using new API.
		$line_items = array(
			array(
				'name'     => $final_description,
				'quantity' => 1,
				'amount'   => (float) $amount,
			),
		);

		$transaction_id = TransactionAPI::create_transaction(
			$line_items,
			array(
				'currency'    => $currency,
				'description' => $final_description,
				'post_id'     => $post_id,
				'user_id'     => get_current_user_id(),
				'metadata'    => array(
					'post_id'         => $post_id,
					'user_id'         => get_current_user_id(),
					'legacy_rest_api' => true,
				),
			)
		);

		// Prepare redirect URL.
		$redirect_url = add_query_arg(
			array(
				'fair_payment_callback' => 'true',
				'transaction_id'        => $transaction_id,
				'post_id'               => $post_id,
			),
			$post_id ? get_permalink( $post_id ) : home_url()
		);

		if ( is_wp_error( $transaction_id ) ) {
			$logger->log(
				'transaction_creation_failed',
				array(
					'level'   => 'error',
					'message' => $transaction_id->get_error_message(),
					'context' => array(
						'error_code' => $transaction_id->get_error_code(),
					),
				)
			);
			return new WP_Error(
				'transaction_creation_failed',
				$transaction_id->get_error_message(),
				array( 'status' => 500 )
			);
		}

		// Initiate payment immediately.
		$payment = TransactionAPI::initiate_payment(
			$transaction_id,
			array(
				'redirect_url' => $redirect_url,
				'webhook_url'  => rest_url( 'fair-payment/v1/webhook' ),
			)
		);

		if ( is_wp_error( $payment ) ) {
			$logger->log(
				'payment_initiation_failed',
				array(
					'level'          => 'error',
					'transaction_id' => (int) $transaction_id,
					'message'        => $payment->get_error_message(),
					'context'        => array(
						'error_code' => $payment->get_error_code(),
					),
				)
			);
			return new WP_Error(
				'payment_initiation_failed',
				$payment->get_error_message(),
				array( 'status' => 500 )
			);
		}

		$logger->log(
			'payment_creation_succeeded',
			array(
				'level'          => 'info',
				'transaction_id' => (int) $transaction_id,
				'message'        => sprintf(
					'Payment created successfully (Mollie %s)',
					$payment['mollie_payment_id']
				),
				'context'        => array(
					'mollie_payment_id' => $payment['mollie_payment_id'],
					'status'            => $payment['status'],
				),
			)
		);

		// Return same response structure for backward compatibility.
		return new WP_REST_Response(
			array(
				'success'           => true,
				'transaction_id'    => $transaction_id,
				'mollie_payment_id' => $payment['mollie_payment_id'],
				'checkout_url'      => $payment['checkout_url'],
				'status'            => $payment['status'],
			),
			201
		);
	}

	/**
	 * Get transaction status
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_transaction_status( WP_REST_Request $request ) {
		$transaction_id = $request->get_param( 'transaction_id' );

		// Get transaction from database.
		$transaction = Transaction::get_by_id( $transaction_id );

		if ( ! $transaction ) {
			return new WP_Error(
				'transaction_not_found',
				__( 'Transaction not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		// Prepare response data.
		$response_data = array(
			'transaction_id'    => $transaction->id,
			'status'            => $transaction->status,
			'amount'            => $transaction->amount,
			'currency'          => $transaction->currency,
			'description'       => $transaction->description,
			'mollie_payment_id' => $transaction->mollie_payment_id,
			'testmode'          => (bool) $transaction->testmode,
		);

		return new WP_REST_Response( $response_data, 200 );
	}
}
