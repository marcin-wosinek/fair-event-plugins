<?php
/**
 * API controller for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Api\Controllers;

defined( 'WPINC' ) || die;

/**
 * Base API controller class
 */
class ApiController {

	/**
	 * Validate required parameters
	 *
	 * @param array $params Parameters to validate.
	 * @param array $required Required parameter names.
	 * @return WP_Error|true True if valid, WP_Error if invalid.
	 */
	protected function validate_required_params( $params, $required ) {
		foreach ( $required as $param ) {
			if ( ! isset( $params[ $param ] ) || empty( $params[ $param ] ) ) {
				return new \WP_Error(
					'missing_parameter',
					sprintf(
						/* translators: %s: parameter name */
						__( 'Missing required parameter: %s', 'fair-payment' ),
						$param
					),
					array( 'status' => 400 )
				);
			}
		}

		return true;
	}

	/**
	 * Create a standardized success response
	 *
	 * @param array  $data Response data.
	 * @param int    $status HTTP status code.
	 * @param string $message Optional success message.
	 * @return WP_REST_Response
	 */
	protected function success_response( $data, $status = 200, $message = '' ) {
		return new \WP_REST_Response(
			array(
				'success'   => true,
				'data'      => $data,
				'message'   => $message,
				'timestamp' => current_time( 'mysql' ),
			),
			$status
		);
	}

	/**
	 * Create a standardized error response
	 *
	 * @param string $code Error code.
	 * @param string $message Error message.
	 * @param int    $status HTTP status code.
	 * @param array  $data Optional error data.
	 * @return WP_REST_Response
	 */
	protected function error_response( $code, $message, $status = 400, $data = array() ) {
		return new \WP_REST_Response(
			array(
				'success'   => false,
				'error'     => array(
					'code'    => $code,
					'message' => $message,
					'data'    => $data,
				),
				'timestamp' => current_time( 'mysql' ),
			),
			$status
		);
	}

	/**
	 * Sanitize payment amount
	 *
	 * @param string $amount Payment amount.
	 * @return float Sanitized amount.
	 */
	protected function sanitize_amount( $amount ) {
		return floatval( $amount );
	}

	/**
	 * Sanitize currency code
	 *
	 * @param string $currency Currency code.
	 * @return string Sanitized currency code.
	 */
	protected function sanitize_currency( $currency ) {
		$allowed_currencies = array( 'USD', 'EUR', 'GBP' );
		$currency           = strtoupper( sanitize_text_field( $currency ) );

		return in_array( $currency, $allowed_currencies, true ) ? $currency : 'EUR';
	}

	/**
	 * Generate a unique payment ID
	 *
	 * @param string $prefix Optional prefix.
	 * @return string Payment ID.
	 */
	protected function generate_payment_id( $prefix = 'pay' ) {
		return $prefix . '_' . wp_generate_password( 16, false );
	}

	/**
	 * Log API activity (for debugging)
	 *
	 * @param string $endpoint Endpoint name.
	 * @param array  $request_data Request data.
	 * @param array  $response_data Response data.
	 * @return void
	 */
	protected function log_activity( $endpoint, $request_data, $response_data ) {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log(
				sprintf(
					'Fair Payment API - %s: Request: %s | Response: %s',
					$endpoint,
					wp_json_encode( $request_data ),
					wp_json_encode( $response_data )
				)
			);
		}
	}

	/**
	 * Get client IP address
	 *
	 * @return string Client IP address.
	 */
	protected function get_client_ip() {
		$ip_keys = array( 'HTTP_CLIENT_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR' );

		foreach ( $ip_keys as $key ) {
			if ( array_key_exists( $key, $_SERVER ) === true ) {
				$ip = sanitize_text_field( wp_unslash( $_SERVER[ $key ] ) );

				foreach ( explode( ',', $ip ) as $ip_part ) {
					$ip_part = trim( $ip_part );

					if ( filter_var( $ip_part, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) !== false ) {
						return $ip_part;
					}
				}
			}
		}

		return '127.0.0.1';
	}

	/**
	 * Rate limiting check (basic implementation)
	 *
	 * @param string $identifier Unique identifier (IP, user ID, etc.).
	 * @param int    $limit Request limit per time window.
	 * @param int    $window Time window in seconds.
	 * @return bool True if within limits, false otherwise.
	 */
	protected function check_rate_limit( $identifier, $limit = 60, $window = 3600 ) {
		$transient_key = 'fair_payment_rate_limit_' . md5( $identifier );
		$current_count = get_transient( $transient_key );

		if ( false === $current_count ) {
			set_transient( $transient_key, 1, $window );
			return true;
		}

		if ( $current_count >= $limit ) {
			return false;
		}

		set_transient( $transient_key, $current_count + 1, $window );
		return true;
	}
}
