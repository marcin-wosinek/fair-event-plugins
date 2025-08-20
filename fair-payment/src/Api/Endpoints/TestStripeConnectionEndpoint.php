<?php
/**
 * Test Stripe connection endpoint for Fair Payment API
 *
 * @package FairPayment
 */

namespace FairPayment\Api\Endpoints;

use FairPayment\Api\Controllers\ApiController;

defined( 'WPINC' ) || die;

/**
 * Test Stripe connection endpoint class
 */
class TestStripeConnectionEndpoint extends ApiController {

	/**
	 * Handle the test Stripe connection request
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function handle( $request ) {
		// Rate limiting - allow more frequent testing for this endpoint
		$client_ip = $this->get_client_ip();
		if ( ! $this->check_rate_limit( $client_ip, 20, 3600 ) ) {
			return $this->error_response(
				'rate_limit_exceeded',
				__( 'Too many connection test requests. Please try again later.', 'fair-payment' ),
				429
			);
		}

		// Get and validate parameters
		$params = $request->get_json_params();
		if ( ! $params ) {
			$params = $request->get_body_params();
		}

		// Validate required parameters
		$validation = $this->validate_required_params( $params, array( 'secret_key' ) );
		if ( is_wp_error( $validation ) ) {
			return $this->error_response(
				$validation->get_error_code(),
				$validation->get_error_message(),
				400
			);
		}

		// Sanitize input
		$secret_key = sanitize_text_field( $params['secret_key'] );
		$publishable_key = isset( $params['publishable_key'] ) ? sanitize_text_field( $params['publishable_key'] ) : '';

		// Test the Stripe connection
		$result = $this->test_stripe_credentials( $secret_key, $publishable_key );

		if ( is_wp_error( $result ) ) {
			return $this->error_response(
				$result->get_error_code(),
				$result->get_error_message(),
				400
			);
		}

		// Log activity
		$this->log_activity( 'test-stripe-connection', $params, $result );

		return $this->success_response(
			$result,
			200,
			__( 'Stripe connection test completed', 'fair-payment' )
		);
	}

	/**
	 * Test Stripe API credentials using Balance endpoint
	 *
	 * @param string $secret_key Stripe secret key.
	 * @param string $publishable_key Optional publishable key for validation.
	 * @return array|WP_Error Result of validation or error.
	 */
	private function test_stripe_credentials( $secret_key, $publishable_key = '' ) {
		// Validate secret key
		$secret_validation = $this->validate_secret_key( $secret_key );
		if ( is_wp_error( $secret_validation ) ) {
			return $secret_validation;
		}

		// Test secret key with Balance API
		$balance_result = $this->test_balance_endpoint( $secret_key );
		if ( is_wp_error( $balance_result ) ) {
			return $balance_result;
		}

		// Validate publishable key if provided
		$publishable_validation = null;
		if ( ! empty( $publishable_key ) ) {
			$publishable_validation = $this->validate_publishable_key( $publishable_key, $balance_result['mode'] );
		}

		// Prepare response
		$response = array(
			'secret_key' => array(
				'valid'      => true,
				'mode'       => $balance_result['mode'],
				'format'     => 'valid',
			),
			'balance' => array(
				'available'     => $balance_result['balance']['available'] ?? array(),
				'pending'       => $balance_result['balance']['pending'] ?? array(),
				'currencies'    => $balance_result['currencies'] ?? array(),
			),
			'account' => array(
				'mode'          => $balance_result['mode'],
				'country'       => $balance_result['balance']['object'] ?? null,
			),
			'connection' => array(
				'status'        => 'success',
				'response_time' => $balance_result['response_time'] ?? null,
				'api_version'   => '2023-10-16',
			),
		);

		// Add publishable key validation if tested
		if ( $publishable_validation ) {
			if ( is_wp_error( $publishable_validation ) ) {
				$response['publishable_key'] = array(
					'valid'  => false,
					'error'  => $publishable_validation->get_error_message(),
					'format' => $this->validate_key_format( $publishable_key, 'pk' ) ? 'valid' : 'invalid',
				);
			} else {
				$response['publishable_key'] = array(
					'valid'  => true,
					'mode'   => $publishable_validation['mode'],
					'format' => 'valid',
				);
			}
		}

		return $response;
	}

	/**
	 * Validate secret key format and basic requirements
	 *
	 * @param string $secret_key Secret key to validate.
	 * @return WP_Error|array Error or success array.
	 */
	private function validate_secret_key( $secret_key ) {
		if ( empty( $secret_key ) ) {
			return new WP_Error( 'empty_secret_key', __( 'Secret key is required', 'fair-payment' ) );
		}

		if ( ! $this->validate_key_format( $secret_key, 'sk' ) ) {
			return new WP_Error( 
				'invalid_secret_key_format', 
				__( 'Invalid secret key format. Must start with sk_test_ or sk_live_', 'fair-payment' ) 
			);
		}

		return array( 'valid' => true );
	}

	/**
	 * Test Stripe Balance endpoint with secret key
	 *
	 * @param string $secret_key Secret key to test.
	 * @return WP_Error|array Error or balance data.
	 */
	private function test_balance_endpoint( $secret_key ) {
		$start_time = microtime( true );

		$response = wp_remote_get( 'https://api.stripe.com/v1/balance', array(
			'headers' => array(
				'Authorization' => 'Bearer ' . $secret_key,
				'Stripe-Version' => '2023-10-16',
				'User-Agent' => 'Fair Payment WordPress Plugin/1.0.0',
			),
			'timeout' => 15,
			'sslverify' => true,
		) );

		$response_time = round( ( microtime( true ) - $start_time ) * 1000, 2 );

		if ( is_wp_error( $response ) ) {
			return new WP_Error( 
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
			$error_message = __( 'Invalid API credentials', 'fair-payment' );
			
			if ( isset( $data['error']['message'] ) ) {
				$error_message = sanitize_text_field( $data['error']['message'] );
			}
			
			return new WP_Error( 'stripe_api_error', $error_message );
		}

		if ( ! $data ) {
			return new WP_Error( 'stripe_invalid_response', __( 'Invalid response from Stripe API', 'fair-payment' ) );
		}

		$mode = strpos( $secret_key, 'sk_test_' ) === 0 ? 'test' : 'live';
		
		return array(
			'valid'         => true,
			'mode'          => $mode,
			'balance'       => $data,
			'currencies'    => array_keys( $data['available'] ?? array() ),
			'response_time' => $response_time,
		);
	}

	/**
	 * Validate publishable key format and mode consistency
	 *
	 * @param string $publishable_key Publishable key to validate.
	 * @param string $secret_key_mode Mode from secret key (test/live).
	 * @return WP_Error|array Error or validation result.
	 */
	private function validate_publishable_key( $publishable_key, $secret_key_mode ) {
		if ( empty( $publishable_key ) ) {
			return new WP_Error( 'empty_publishable_key', __( 'Publishable key is required', 'fair-payment' ) );
		}

		if ( ! $this->validate_key_format( $publishable_key, 'pk' ) ) {
			return new WP_Error( 
				'invalid_publishable_key_format', 
				__( 'Invalid publishable key format. Must start with pk_test_ or pk_live_', 'fair-payment' ) 
			);
		}

		// Check mode consistency
		$publishable_mode = strpos( $publishable_key, 'pk_test_' ) === 0 ? 'test' : 'live';
		
		if ( $publishable_mode !== $secret_key_mode ) {
			return new WP_Error( 
				'key_mode_mismatch', 
				sprintf(
					/* translators: 1: secret key mode, 2: publishable key mode */
					__( 'Key mode mismatch: secret key is %1$s mode but publishable key is %2$s mode', 'fair-payment' ),
					$secret_key_mode,
					$publishable_mode
				)
			);
		}

		return array(
			'valid' => true,
			'mode'  => $publishable_mode,
		);
	}

	/**
	 * Validate Stripe key format
	 *
	 * @param string $key Key to validate.
	 * @param string $prefix Expected prefix (sk or pk).
	 * @return bool True if format is valid.
	 */
	private function validate_key_format( $key, $prefix ) {
		$pattern = sprintf( '/^%s_(test|live)_[a-zA-Z0-9]+$/', $prefix );
		return preg_match( $pattern, $key ) === 1;
	}
}