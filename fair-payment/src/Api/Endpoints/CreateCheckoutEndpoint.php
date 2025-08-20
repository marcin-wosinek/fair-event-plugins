<?php
/**
 * Create checkout endpoint for Fair Payment API
 *
 * @package FairPayment
 */

namespace FairPayment\Api\Endpoints;

use FairPayment\Api\Controllers\ApiController;

defined( 'WPINC' ) || die;

/**
 * Create checkout endpoint class
 */
class CreateCheckoutEndpoint extends ApiController {

	/**
	 * Handle the create checkout request
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function handle( $request ) {
		// Rate limiting
		$client_ip = $this->get_client_ip();
		if ( ! $this->check_rate_limit( $client_ip, 30, 3600 ) ) {
			return $this->error_response(
				'rate_limit_exceeded',
				__( 'Too many requests. Please try again later.', 'fair-payment' ),
				429
			);
		}

		// Get and validate parameters
		$params = $request->get_json_params();
		if ( ! $params ) {
			$params = $request->get_body_params();
		}

		$validation = $this->validate_required_params( $params, array( 'amount', 'currency' ) );
		if ( is_wp_error( $validation ) ) {
			return $this->error_response(
				$validation->get_error_code(),
				$validation->get_error_message(),
				400
			);
		}

		// Sanitize input
		$amount = $this->sanitize_amount( $params['amount'] );
		$currency = $this->sanitize_currency( $params['currency'] );
		$description = isset( $params['description'] ) ? sanitize_text_field( $params['description'] ) : '';
		$metadata = isset( $params['metadata'] ) && is_array( $params['metadata'] ) ? $params['metadata'] : array();

		// Validate amount
		if ( $amount <= 0 ) {
			return $this->error_response(
				'invalid_amount',
				__( 'Amount must be greater than 0', 'fair-payment' ),
				400
			);
		}

		if ( $amount > 10000 ) {
			return $this->error_response(
				'amount_too_large',
				__( 'Amount cannot exceed 10,000', 'fair-payment' ),
				400
			);
		}

		// Generate payment ID and checkout session
		$payment_id = $this->generate_payment_id( 'checkout' );
		$session_id = $this->generate_payment_id( 'session' );

		// No processing fees - use original amount
		$total_amount = $amount;

		// Create checkout data
		$checkout_data = array(
			'payment_id'      => $payment_id,
			'session_id'      => $session_id,
			'amount'          => $amount,
			'currency'        => $currency,
			'total_amount'    => $total_amount,
			'description'     => $description,
			'status'          => 'pending',
			'checkout_url'    => site_url( '/fair-payment/checkout/' . $payment_id ),
			'expires_at'      => gmdate( 'Y-m-d H:i:s', time() + 3600 ), // 1 hour expiry
			'metadata'        => $metadata,
			'created_at'      => current_time( 'mysql' ),
		);

		// Store checkout session (in a real implementation, this would go to database)
		$this->store_checkout_session( $payment_id, $checkout_data );

		// Prepare response
		$response_data = array(
			'payment_id'     => $payment_id,
			'session_id'     => $session_id,
			'checkout_url'   => $checkout_data['checkout_url'],
			'amount'         => array(
				'total'           => $total_amount,
				'currency'        => $currency,
			),
			'expires_at'     => $checkout_data['expires_at'],
			'test_mode'      => $this->is_test_mode(),
		);

		// Log activity
		$this->log_activity( 'create-checkout', $params, $response_data );

		return $this->success_response(
			$response_data,
			201,
			__( 'Checkout session created successfully', 'fair-payment' )
		);
	}

	/**
	 * Store checkout session data
	 *
	 * @param string $payment_id Payment ID.
	 * @param array  $data Checkout data.
	 * @return void
	 */
	private function store_checkout_session( $payment_id, $data ) {
		// In a real implementation, store in database
		// For now, use transients (expires automatically)
		$transient_key = 'fair_payment_checkout_' . $payment_id;
		set_transient( $transient_key, $data, 3600 ); // 1 hour
	}

	/**
	 * Check if plugin is in test mode
	 *
	 * @return bool True if test mode is enabled.
	 */
	private function is_test_mode() {
		$options = get_option( 'fair_payment_options', array() );
		return (bool) ( $options['test_mode'] ?? true );
	}

	/**
	 * Send webhook notification (placeholder)
	 *
	 * @param string $payment_id Payment ID.
	 * @param array  $data Event data.
	 * @return void
	 */
	private function send_webhook( $payment_id, $data ) {
		$webhook_url = get_option( 'fair_payment_webhook_url', '' );
		
		if ( empty( $webhook_url ) ) {
			return;
		}

		// In a real implementation, send webhook notification
		wp_remote_post(
			$webhook_url,
			array(
				'body'    => wp_json_encode(
					array(
						'event'      => 'checkout.created',
						'payment_id' => $payment_id,
						'data'       => $data,
						'timestamp'  => current_time( 'mysql' ),
					)
				),
				'headers' => array(
					'Content-Type' => 'application/json',
				),
				'timeout' => 10,
			)
		);
	}
}