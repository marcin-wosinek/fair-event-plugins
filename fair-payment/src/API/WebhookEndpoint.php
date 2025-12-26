<?php
/**
 * Webhook REST API Endpoint
 *
 * @package FairPayment
 */

namespace FairPayment\API;

use FairPayment\Payment\MolliePaymentHandler;
use FairPayment\Models\Transaction;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Class for handling webhook notifications from Mollie
 */
class WebhookEndpoint extends WP_REST_Controller {

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
	protected $rest_base = 'webhook';

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
					'callback'            => array( $this, 'handle_webhook' ),
					'permission_callback' => '__return_true',
				),
			)
		);
	}

	/**
	 * Handle webhook notification from Mollie
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function handle_webhook( WP_REST_Request $request ) {
		// Get payment ID from webhook.
		$mollie_payment_id = $request->get_param( 'id' );

		if ( empty( $mollie_payment_id ) ) {
			return new WP_Error(
				'missing_payment_id',
				__( 'Payment ID is missing from webhook.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		try {
			// Get transaction from database first to determine testmode.
			$transaction = Transaction::get_by_mollie_id( $mollie_payment_id );

			if ( ! $transaction ) {
				return new WP_Error(
					'transaction_not_found',
					__( 'Transaction not found in database.', 'fair-payment' ),
					array( 'status' => 404 )
				);
			}

			// Retrieve payment status from Mollie using correct testmode.
			$handler = new MolliePaymentHandler();
			$options = array(
				'testmode' => ! empty( $transaction->testmode ),
			);
			$payment = $handler->get_payment( $mollie_payment_id, $options );

			// Update transaction status.
			$updated = Transaction::update_status( $mollie_payment_id, $payment->status );

			if ( ! $updated ) {
				return new WP_Error(
					'status_update_failed',
					__( 'Failed to update transaction status.', 'fair-payment' ),
					array( 'status' => 500 )
				);
			}

			// Handle payment status actions.
			$this->handle_payment_status( $payment, $transaction );

			// Return 200 OK to Mollie.
			return new WP_REST_Response(
				array(
					'success' => true,
					'status'  => $payment->status,
				),
				200
			);

		} catch ( \Exception $e ) {
			// Log error but still return 200 to prevent webhook retries.
			error_log( 'Fair Payment webhook error: ' . $e->getMessage() );

			return new WP_REST_Response(
				array(
					'success' => false,
					'error'   => $e->getMessage(),
				),
				200
			);
		}
	}

	/**
	 * Handle different payment statuses
	 *
	 * @param object $payment Mollie payment object.
	 * @param object $transaction Transaction from database.
	 * @return void
	 */
	private function handle_payment_status( $payment, $transaction ) {
		switch ( $payment->status ) {
			case 'paid':
				/**
				 * Fires when a payment is successfully completed
				 *
				 * @param object $payment Mollie payment object.
				 * @param object $transaction Transaction from database.
				 */
				do_action( 'fair_payment_paid', $payment, $transaction );
				break;

			case 'failed':
			case 'canceled':
			case 'expired':
				/**
				 * Fires when a payment fails, is canceled, or expires
				 *
				 * @param object $payment Mollie payment object.
				 * @param object $transaction Transaction from database.
				 */
				do_action( 'fair_payment_failed', $payment, $transaction );
				break;

			case 'authorized':
				/**
				 * Fires when a payment is authorized
				 *
				 * @param object $payment Mollie payment object.
				 * @param object $transaction Transaction from database.
				 */
				do_action( 'fair_payment_authorized', $payment, $transaction );
				break;
		}

		/**
		 * Fires for any payment status change
		 *
		 * @param object $payment Mollie payment object.
		 * @param object $transaction Transaction from database.
		 */
		do_action( 'fair_payment_status_changed', $payment, $transaction );
	}
}
