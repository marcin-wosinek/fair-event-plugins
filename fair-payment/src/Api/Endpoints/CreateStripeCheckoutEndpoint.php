<?php
/**
 * Create Stripe checkout endpoint for Fair Payment API
 *
 * @package FairPayment
 */

namespace FairPayment\Api\Endpoints;

use FairPayment\Api\Controllers\ApiController;

defined( 'WPINC' ) || die;

/**
 * Create Stripe checkout endpoint class
 */
class CreateStripeCheckoutEndpoint extends ApiController {

	/**
	 * Handle the create Stripe checkout request
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
		$amount      = $this->sanitize_amount( $params['amount'] );
		$currency    = $this->sanitize_currency( $params['currency'] );
		$description = isset( $params['description'] ) ? sanitize_text_field( $params['description'] ) : 'Fair Payment';

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

		// Get Stripe secret key from settings
		$stripe_key = $this->get_stripe_secret_key();
		if ( is_wp_error( $stripe_key ) ) {
			return $this->error_response(
				$stripe_key->get_error_code(),
				$stripe_key->get_error_message(),
				500
			);
		}

		// Create Stripe checkout session
		$checkout_session = $this->create_stripe_checkout_session( $stripe_key, $amount, $currency, $description );
		if ( is_wp_error( $checkout_session ) ) {
			return $this->error_response(
				$checkout_session->get_error_code(),
				$checkout_session->get_error_message(),
				400
			);
		}

		// Generate internal payment ID for tracking
		$payment_id = $this->generate_payment_id( 'stripe' );

		// Store session data for tracking
		$session_data = array(
			'payment_id'        => $payment_id,
			'stripe_session_id' => $checkout_session['id'],
			'amount'            => $amount,
			'currency'          => $currency,
			'description'       => $description,
			'status'            => 'pending',
			'created_at'        => current_time( 'mysql' ),
			'expires_at'        => gmdate( 'Y-m-d H:i:s', time() + 1800 ), // 30 minutes
		);

		$this->store_payment_session( $payment_id, $session_data );

		// Prepare response
		$response_data = array(
			'payment_id'   => $payment_id,
			'checkout_url' => $checkout_session['url'],
			'session_id'   => $checkout_session['id'],
			'amount'       => array(
				'total'    => $amount,
				'currency' => $currency,
			),
			'expires_at'   => $session_data['expires_at'],
			'test_mode'    => $this->is_test_mode(),
		);

		// Log activity
		$this->log_activity( 'create-stripe-checkout', $params, $response_data );

		return $this->success_response(
			$response_data,
			201,
			__( 'Stripe checkout session created successfully', 'fair-payment' )
		);
	}

	/**
	 * Get Stripe secret key from settings
	 *
	 * @return string|WP_Error Stripe secret key or error.
	 */
	private function get_stripe_secret_key() {
		$options    = get_option( 'fair_payment_options', array() );
		$secret_key = $options['stripe_secret_key'] ?? '';

		if ( empty( $secret_key ) ) {
			return new \WP_Error(
				'stripe_not_configured',
				__( 'Stripe is not configured. Please check plugin settings.', 'fair-payment' )
			);
		}

		// Validate key format (both test and live keys are acceptable)
		if ( strpos( $secret_key, 'sk_test_' ) !== 0 && strpos( $secret_key, 'sk_live_' ) !== 0 ) {
			return new \WP_Error(
				'invalid_stripe_key',
				__( 'Invalid Stripe key format. Expected key starting with sk_test_ or sk_live_', 'fair-payment' )
			);
		}

		return $secret_key;
	}

	/**
	 * Create Stripe checkout session
	 *
	 * @param string $secret_key Stripe secret key.
	 * @param float  $amount Amount in major currency unit.
	 * @param string $currency Currency code.
	 * @param string $description Payment description.
	 * @return array|WP_Error Checkout session data or error.
	 */
	private function create_stripe_checkout_session( $secret_key, $amount, $currency, $description ) {
		// Convert amount to cents/minor units
		$amount_cents = $this->convert_to_minor_units( $amount, $currency );

		$session_data = array(
			'payment_method_types' => array( 'card' ),
			'line_items'           => array(
				array(
					'price_data' => array(
						'currency'     => strtolower( $currency ),
						'product_data' => array(
							'name'        => $description,
							'description' => sprintf(
								/* translators: 1: amount, 2: currency */
								__( 'Payment of %1$s %2$s', 'fair-payment' ),
								$amount,
								$currency
							),
						),
						'unit_amount'  => $amount_cents,
					),
					'quantity'   => 1,
				),
			),
			'mode'                 => 'payment',
			'success_url'          => site_url( '/fair-payment/success?session_id={CHECKOUT_SESSION_ID}' ),
			'cancel_url'           => site_url( '/fair-payment/cancel' ),
			'expires_at'           => time() + 1800, // 30 minutes
			'metadata'             => array(
				'plugin'   => 'fair-payment',
				'site_url' => site_url(),
				'amount'   => $amount,
				'currency' => $currency,
			),
		);

		$response = wp_remote_post(
			'https://api.stripe.com/v1/checkout/sessions',
			array(
				'headers'   => array(
					'Authorization'  => 'Bearer ' . $secret_key,
					'Content-Type'   => 'application/x-www-form-urlencoded',
					'Stripe-Version' => '2023-10-16',
					'User-Agent'     => 'Fair Payment WordPress Plugin/1.0.0',
				),
				'body'      => $this->build_stripe_form_data( $session_data ),
				'timeout'   => 30,
				'sslverify' => true,
			)
		);

		if ( is_wp_error( $response ) ) {
			return new \WP_Error(
				'stripe_connection_failed',
				sprintf(
					/* translators: %s: error message */
					__( 'Unable to connect to Stripe API: %s', 'fair-payment' ),
					$response->get_error_message()
				)
			);
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		if ( $code !== 200 ) {
			$error_message = __( 'Failed to create checkout session', 'fair-payment' );

			if ( isset( $data['error']['message'] ) ) {
				$error_message = sanitize_text_field( $data['error']['message'] );
			}

			return new \WP_Error( 'stripe_checkout_failed', $error_message );
		}

		if ( ! $data || ! isset( $data['id'] ) || ! isset( $data['url'] ) ) {
			return new \WP_Error( 'stripe_invalid_response', __( 'Invalid response from Stripe API', 'fair-payment' ) );
		}

		return $data;
	}

	/**
	 * Convert amount to minor currency units (cents)
	 *
	 * @param float  $amount Amount in major units.
	 * @param string $currency Currency code.
	 * @return int Amount in minor units.
	 */
	private function convert_to_minor_units( $amount, $currency ) {
		// Zero-decimal currencies (amounts in smallest unit)
		$zero_decimal = array( 'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF' );

		if ( in_array( strtoupper( $currency ), $zero_decimal, true ) ) {
			return intval( $amount );
		}

		// Most currencies use 2 decimal places
		return intval( $amount * 100 );
	}

	/**
	 * Build form data for Stripe API
	 *
	 * @param array  $data Data array.
	 * @param string $prefix Key prefix for nested arrays.
	 * @return string Form-encoded data.
	 */
	private function build_stripe_form_data( $data, $prefix = '' ) {
		$params = array();

		foreach ( $data as $key => $value ) {
			$param_key = $prefix ? $prefix . '[' . $key . ']' : $key;

			if ( is_array( $value ) ) {
				$params[] = $this->build_stripe_form_data( $value, $param_key );
			} else {
				$params[] = urlencode( $param_key ) . '=' . urlencode( $value );
			}
		}

		return implode( '&', $params );
	}

	/**
	 * Store payment session data
	 *
	 * @param string $payment_id Payment ID.
	 * @param array  $data Session data.
	 * @return void
	 */
	private function store_payment_session( $payment_id, $data ) {
		// Store in transients for now (in production, use database)
		$transient_key = 'fair_payment_stripe_' . $payment_id;
		set_transient( $transient_key, $data, 1800 ); // 30 minutes
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
}
