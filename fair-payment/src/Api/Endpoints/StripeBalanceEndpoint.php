<?php
/**
 * Stripe balance endpoint for Fair Payment API
 *
 * @package FairPayment
 */

namespace FairPayment\Api\Endpoints;

use FairPayment\Api\Controllers\ApiController;

defined( 'WPINC' ) || die;

/**
 * Stripe balance endpoint class
 */
class StripeBalanceEndpoint extends ApiController {

	/**
	 * Handle the get Stripe balance request
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function handle( $request ) {
		// Check if user has admin capabilities
		if ( ! current_user_can( 'manage_options' ) ) {
			return $this->error_response(
				'insufficient_permissions',
				__( 'You do not have permission to view Stripe balance information.', 'fair-payment' ),
				403
			);
		}

		// Get saved Stripe configuration
		$options = get_option( 'fair_payment_options', array() );
		$secret_key = $options['stripe_secret_key'] ?? '';

		if ( empty( $secret_key ) ) {
			return $this->error_response(
				'missing_stripe_key',
				__( 'Stripe secret key is not configured. Please check your plugin settings.', 'fair-payment' ),
				400
			);
		}

		// Rate limiting
		$client_ip = $this->get_client_ip();
		if ( ! $this->check_rate_limit( $client_ip, 10, 600 ) ) {
			return $this->error_response(
				'rate_limit_exceeded',
				__( 'Too many balance requests. Please try again later.', 'fair-payment' ),
				429
			);
		}

		try {
			$balance = $this->get_stripe_balance( $secret_key );
			
			return $this->success_response(
				$balance,
				__( 'Balance retrieved successfully', 'fair-payment' )
			);
		} catch ( \Exception $e ) {
			return $this->error_response(
				'stripe_api_error',
				sprintf(
					/* translators: %s: error message */
					__( 'Failed to retrieve balance: %s', 'fair-payment' ),
					$e->getMessage()
				),
				500
			);
		}
	}

	/**
	 * Get Stripe account balance using the API
	 *
	 * @param string $secret_key Stripe secret key.
	 * @return array Balance data.
	 * @throws \Exception When API request fails.
	 */
	private function get_stripe_balance( $secret_key ) {
		$url = 'https://api.stripe.com/v1/balance';
		
		$response = wp_remote_get( $url, array(
			'headers' => array(
				'Authorization' => 'Bearer ' . $secret_key,
				'Stripe-Version' => '2023-10-16',
			),
			'timeout' => 30,
		) );

		if ( is_wp_error( $response ) ) {
			throw new \Exception( 'Failed to connect to Stripe API: ' . $response->get_error_message() );
		}

		$response_code = wp_remote_retrieve_response_code( $response );
		$response_body = wp_remote_retrieve_body( $response );

		if ( $response_code !== 200 ) {
			$error_data = json_decode( $response_body, true );
			$error_message = $error_data['error']['message'] ?? 'Unknown error occurred';
			throw new \Exception( $error_message );
		}

		$balance_data = json_decode( $response_body, true );
		
		if ( ! $balance_data || ! isset( $balance_data['available'] ) ) {
			throw new \Exception( 'Invalid response from Stripe API' );
		}

		return array(
			'available' => $balance_data['available'] ?? array(),
			'pending' => $balance_data['pending'] ?? array(),
			'reserved' => $balance_data['reserved'] ?? array(),
			'livemode' => $balance_data['livemode'] ?? false,
			'retrieved_at' => current_time( 'mysql' ),
		);
	}
}