<?php
/**
 * Create simple payment endpoint for Fair Payment API
 *
 * @package FairPayment
 */

namespace FairPayment\Api\Endpoints;

use FairPayment\Api\Controllers\ApiController;

defined( 'WPINC' ) || die;

/**
 * Create simple payment endpoint class
 */
class CreateSimplePaymentEndpoint extends ApiController {

	/**
	 * Handle the create simple payment request
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function handle( $request ) {
		// Rate limiting
		$client_ip = $this->get_client_ip();
		if ( ! $this->check_rate_limit( $client_ip, 10, 3600 ) ) {
			return $this->error_response(
				'rate_limit_exceeded',
				__( 'Too many payment requests. Please try again later.', 'fair-payment' ),
				429
			);
		}

		// Get and validate parameters
		$params = $request->get_json_params();
		if ( ! $params ) {
			$params = $request->get_body_params();
		}

		$validation = $this->validate_required_params( 
			$params, 
			array( 'amount', 'currency', 'customer_email' ) 
		);
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
		$customer_email = sanitize_email( $params['customer_email'] );
		$customer_name = isset( $params['customer_name'] ) ? sanitize_text_field( $params['customer_name'] ) : '';

		// Validate input
		if ( $amount <= 0 ) {
			return $this->error_response(
				'invalid_amount',
				__( 'Amount must be greater than 0', 'fair-payment' ),
				400
			);
		}

		if ( $amount > 5000 ) {
			return $this->error_response(
				'amount_too_large',
				__( 'Amount cannot exceed 5,000 for simple payments', 'fair-payment' ),
				400
			);
		}

		if ( ! is_email( $customer_email ) ) {
			return $this->error_response(
				'invalid_email',
				__( 'Please provide a valid email address', 'fair-payment' ),
				400
			);
		}

		// Generate payment ID and transaction data
		$payment_id = $this->generate_payment_id( 'simple' );
		$transaction_id = $this->generate_payment_id( 'txn' );

		// No processing fees - use original amount
		$total_amount = $amount;

		// Create payment data
		$payment_data = array(
			'payment_id'      => $payment_id,
			'transaction_id'  => $transaction_id,
			'type'            => 'simple_payment',
			'amount'          => $amount,
			'currency'        => $currency,
			'total_amount'    => $total_amount,
			'customer_email'  => $customer_email,
			'customer_name'   => $customer_name,
			'status'          => $this->simulate_payment_status(),
			'payment_url'     => site_url( '/fair-payment/result/' . $payment_id ),
			'created_at'      => current_time( 'mysql' ),
			'processed_at'    => current_time( 'mysql' ),
			'client_ip'       => $client_ip,
			'user_agent'      => isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '',
		);

		// Store payment data
		$this->store_payment_data( $payment_id, $payment_data );

		// Send confirmation email (in a real implementation)
		if ( $payment_data['status'] === 'completed' ) {
			$this->send_payment_confirmation( $payment_data );
		}

		// Prepare response
		$response_data = array(
			'payment_id'     => $payment_id,
			'transaction_id' => $transaction_id,
			'status'         => $payment_data['status'],
			'amount'         => array(
				'total'           => $total_amount,
				'currency'        => $currency,
			),
			'customer'       => array(
				'email' => $customer_email,
				'name'  => $customer_name,
			),
			'payment_url'    => $payment_data['payment_url'],
			'receipt_url'    => site_url( '/fair-payment/result/' . $payment_id ),
			'test_mode'      => $this->is_test_mode(),
			'message'        => $this->get_status_message( $payment_data['status'] ),
		);

		// Log activity
		$this->log_activity( 'create-simple-payment', $params, $response_data );

		$status_code = $payment_data['status'] === 'completed' ? 201 : 202;

		return $this->success_response(
			$response_data,
			$status_code,
			__( 'Payment processed successfully', 'fair-payment' )
		);
	}

	/**
	 * Store payment data
	 *
	 * @param string $payment_id Payment ID.
	 * @param array  $data Payment data.
	 * @return void
	 */
	private function store_payment_data( $payment_id, $data ) {
		// In a real implementation, store in database
		// For now, use transients
		$transient_key = 'fair_payment_simple_' . $payment_id;
		set_transient( $transient_key, $data, DAY_IN_SECONDS );

		// Also store in a list for admin panel
		$payments_list = get_option( 'fair_payment_simple_payments', array() );
		$payments_list[ $payment_id ] = array(
			'payment_id'     => $payment_id,
			'amount'         => $data['total_amount'],
			'currency'       => $data['currency'],
			'customer_email' => $data['customer_email'],
			'status'         => $data['status'],
			'created_at'     => $data['created_at'],
		);

		// Keep only last 100 payments
		if ( count( $payments_list ) > 100 ) {
			$payments_list = array_slice( $payments_list, -100, null, true );
		}

		update_option( 'fair_payment_simple_payments', $payments_list );
	}

	/**
	 * Simulate payment status for demonstration
	 *
	 * @return string Payment status.
	 */
	private function simulate_payment_status() {
		// 80% success rate for demo
		$random = wp_rand( 1, 10 );
		
		if ( $random <= 8 ) {
			return 'completed';
		} elseif ( $random === 9 ) {
			return 'pending';
		} else {
			return 'failed';
		}
	}

	/**
	 * Get status message based on payment status
	 *
	 * @param string $status Payment status.
	 * @return string Status message.
	 */
	private function get_status_message( $status ) {
		switch ( $status ) {
			case 'completed':
				return __( 'Payment completed successfully', 'fair-payment' );
			case 'pending':
				return __( 'Payment is being processed and will be completed shortly', 'fair-payment' );
			case 'failed':
				return __( 'Payment failed. Please try again or contact support', 'fair-payment' );
			default:
				return __( 'Unknown payment status', 'fair-payment' );
		}
	}

	/**
	 * Send payment confirmation email (placeholder)
	 *
	 * @param array $payment_data Payment data.
	 * @return void
	 */
	private function send_payment_confirmation( $payment_data ) {
		$to = $payment_data['customer_email'];
		$subject = sprintf(
			/* translators: %s: payment ID */
			__( 'Payment Confirmation - %s', 'fair-payment' ),
			$payment_data['payment_id']
		);
		
		$message = sprintf(
			/* translators: 1: customer name, 2: amount, 3: currency, 4: payment ID */
			__( 'Dear %1$s,

Thank you for your payment of %2$s %3$s.

Payment Details:
- Payment ID: %4$s
- Amount: %2$s %3$s
- Status: Completed
- Date: %5$s

You can view your receipt at: %6$s

Best regards,
Fair Payment Team', 'fair-payment' ),
			$payment_data['customer_name'] ?: __( 'Customer', 'fair-payment' ),
			$payment_data['total_amount'],
			$payment_data['currency'],
			$payment_data['payment_id'],
			$payment_data['created_at'],
			$payment_data['payment_url']
		);

		// In a real implementation, send actual email
		// wp_mail( $to, $subject, $message );
		
		// Log email sending for debugging
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( "Fair Payment: Would send confirmation email to {$to}" );
		}
	}

	/**
	 * Check if plugin is in test mode
	 *
	 * @return bool True if test mode is enabled.
	 */
	private function is_test_mode() {
		return (bool) get_option( 'fair_payment_test_mode', true );
	}
}