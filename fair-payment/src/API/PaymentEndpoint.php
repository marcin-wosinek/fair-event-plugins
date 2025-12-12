<?php
/**
 * Payment REST API Endpoint
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
	}

	/**
	 * Create a new payment
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_payment( WP_REST_Request $request ) {
		// TODO: Implement different behavior for logged-in vs anonymous users
		// - Logged-in users: Track in user profile
		// - Anonymous users: Require email
		// See: REST_API_BACKEND.md for implementation guidance

		// Check if Mollie is configured.
		if ( ! MolliePaymentHandler::is_configured() ) {
			return new WP_Error(
				'mollie_not_configured',
				__( 'Mollie payment gateway is not configured. Please configure your API keys in settings.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		$amount      = $request->get_param( 'amount' );
		$currency    = $request->get_param( 'currency' );
		$description = $request->get_param( 'description' );
		$post_id     = $request->get_param( 'post_id' );

		// Validate amount.
		if ( ! is_numeric( $amount ) || $amount <= 0 ) {
			return new WP_Error(
				'invalid_amount',
				__( 'Invalid payment amount.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		// Prepare payment data.
		$payment_args = array(
			'amount'       => $amount,
			'currency'     => $currency,
			'description'  => ! empty( $description ) ? $description : sprintf(
				/* translators: %s: amount and currency */
				__( 'Payment of %1$s %2$s', 'fair-payment' ),
				$amount,
				$currency
			),
			'redirect_url' => add_query_arg(
				array(
					'payment_redirect' => '1',
					'post_id'          => $post_id,
				),
				$post_id ? get_permalink( $post_id ) : home_url()
			),
			'webhook_url'  => rest_url( 'fair-payment/v1/webhook' ),
			'metadata'     => array(
				'post_id' => $post_id,
				'user_id' => get_current_user_id(),
			),
		);

		try {
			// Create payment with Mollie.
			$handler        = new MolliePaymentHandler();
			$mollie_payment = $handler->create_payment( $payment_args );

			// Store transaction in database.
			$transaction_id = Transaction::create(
				array(
					'mollie_payment_id' => $mollie_payment['mollie_payment_id'],
					'post_id'           => $post_id,
					'user_id'           => get_current_user_id(),
					'amount'            => $amount,
					'currency'          => $currency,
					'status'            => $mollie_payment['status'],
					'description'       => $payment_args['description'],
					'redirect_url'      => $payment_args['redirect_url'],
					'webhook_url'       => $payment_args['webhook_url'],
					'checkout_url'      => $mollie_payment['checkout_url'],
					'metadata'          => $payment_args['metadata'],
				)
			);

			if ( ! $transaction_id ) {
				return new WP_Error(
					'transaction_creation_failed',
					__( 'Failed to store transaction in database.', 'fair-payment' ),
					array( 'status' => 500 )
				);
			}

			return new WP_REST_Response(
				array(
					'success'           => true,
					'transaction_id'    => $transaction_id,
					'mollie_payment_id' => $mollie_payment['mollie_payment_id'],
					'checkout_url'      => $mollie_payment['checkout_url'],
					'status'            => $mollie_payment['status'],
				),
				201
			);

		} catch ( \Exception $e ) {
			return new WP_Error(
				'payment_creation_failed',
				$e->getMessage(),
				array( 'status' => 500 )
			);
		}
	}
}
