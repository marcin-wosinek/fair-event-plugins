<?php
/**
 * API hooks for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Hooks;

use FairPayment\Api\Endpoints\CreateCheckoutEndpoint;
use FairPayment\Api\Endpoints\CreateSimplePaymentEndpoint;
use FairPayment\Api\Endpoints\TestStripeConnectionEndpoint;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress REST API endpoints registration
 */
class ApiHooks {

	/**
	 * API namespace
	 */
	const NAMESPACE = 'fair-payment/v1';

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_api_endpoints' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'localize_api_data' ) );
	}

	/**
	 * Register REST API endpoints
	 *
	 * @return void
	 */
	public function register_api_endpoints() {
		// Create checkout endpoint
		register_rest_route(
			self::NAMESPACE,
			'/create-checkout',
			array(
				'methods'             => 'POST',
				'callback'            => array( new CreateCheckoutEndpoint(), 'handle' ),
				'permission_callback' => array( $this, 'check_api_permissions' ),
				'args'                => $this->get_create_checkout_args(),
			)
		);

		// Create simple payment endpoint
		register_rest_route(
			self::NAMESPACE,
			'/create-simple-payment',
			array(
				'methods'             => 'POST',
				'callback'            => array( new CreateSimplePaymentEndpoint(), 'handle' ),
				'permission_callback' => array( $this, 'check_api_permissions' ),
				'args'                => $this->get_create_simple_payment_args(),
			)
		);

		// Test Stripe connection endpoint
		register_rest_route(
			self::NAMESPACE,
			'/test-stripe-connection',
			array(
				'methods'             => 'POST',
				'callback'            => array( new TestStripeConnectionEndpoint(), 'handle' ),
				'permission_callback' => array( $this, 'check_api_permissions' ),
				'args'                => $this->get_test_stripe_connection_args(),
			)
		);

		// Get payment status endpoint
		register_rest_route(
			self::NAMESPACE,
			'/payment-status/(?P<payment_id>[a-zA-Z0-9_-]+)',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_payment_status' ),
				'permission_callback' => array( $this, 'check_api_permissions' ),
				'args'                => array(
					'payment_id' => array(
						'required'    => true,
						'type'        => 'string',
						'description' => __( 'Payment ID to check status for', 'fair-payment' ),
					),
				),
			)
		);
	}

	/**
	 * Check API permissions
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error True if allowed, WP_Error otherwise.
	 */
	public function check_api_permissions( $request ) {
		// For now, allow public access with nonce verification
		$nonce = $request->get_header( 'X-WP-Nonce' );
		
		if ( ! $nonce ) {
			// Check for nonce in request body
			$params = $request->get_json_params();
			$nonce = $params['_wpnonce'] ?? '';
		}

		if ( ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
			return new \WP_Error(
				'rest_forbidden',
				__( 'Invalid nonce. Please refresh the page and try again.', 'fair-payment' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Get arguments for create-checkout endpoint
	 *
	 * @return array Endpoint arguments.
	 */
	private function get_create_checkout_args() {
		return array(
			'amount' => array(
				'required'          => true,
				'type'              => 'string',
				'description'       => __( 'Payment amount', 'fair-payment' ),
				'validate_callback' => function( $param ) {
					return is_numeric( $param ) && $param > 0;
				},
			),
			'currency' => array(
				'required'          => true,
				'type'              => 'string',
				'description'       => __( 'Payment currency', 'fair-payment' ),
				'validate_callback' => function( $param ) {
					$options = get_option( 'fair_payment_options', array() );
					$allowed_currencies = $options['allowed_currencies'] ?? array( 'EUR', 'USD', 'GBP' );
					return in_array( strtoupper( $param ), $allowed_currencies, true );
				},
			),
			'description' => array(
				'required'    => false,
				'type'        => 'string',
				'description' => __( 'Payment description', 'fair-payment' ),
			),
			'metadata' => array(
				'required'    => false,
				'type'        => 'object',
				'description' => __( 'Additional metadata', 'fair-payment' ),
			),
			'_wpnonce' => array(
				'required'    => true,
				'type'        => 'string',
				'description' => __( 'WordPress nonce for security', 'fair-payment' ),
			),
		);
	}

	/**
	 * Get arguments for create-simple-payment endpoint
	 *
	 * @return array Endpoint arguments.
	 */
	private function get_create_simple_payment_args() {
		return array(
			'amount' => array(
				'required'          => true,
				'type'              => 'string',
				'description'       => __( 'Payment amount', 'fair-payment' ),
				'validate_callback' => function( $param ) {
					return is_numeric( $param ) && $param > 0;
				},
			),
			'currency' => array(
				'required'          => true,
				'type'              => 'string',
				'description'       => __( 'Payment currency', 'fair-payment' ),
				'validate_callback' => function( $param ) {
					$options = get_option( 'fair_payment_options', array() );
					$allowed_currencies = $options['allowed_currencies'] ?? array( 'EUR', 'USD', 'GBP' );
					return in_array( strtoupper( $param ), $allowed_currencies, true );
				},
			),
			'customer_email' => array(
				'required'          => true,
				'type'              => 'string',
				'description'       => __( 'Customer email address', 'fair-payment' ),
				'validate_callback' => function( $param ) {
					return is_email( $param );
				},
			),
			'customer_name' => array(
				'required'    => false,
				'type'        => 'string',
				'description' => __( 'Customer name', 'fair-payment' ),
			),
			'_wpnonce' => array(
				'required'    => true,
				'type'        => 'string',
				'description' => __( 'WordPress nonce for security', 'fair-payment' ),
			),
		);
	}

	/**
	 * Get arguments for test-stripe-connection endpoint
	 *
	 * @return array Endpoint arguments.
	 */
	private function get_test_stripe_connection_args() {
		return array(
			'secret_key' => array(
				'required'          => true,
				'type'              => 'string',
				'description'       => __( 'Stripe secret key to test', 'fair-payment' ),
				'validate_callback' => function( $param ) {
					return ! empty( $param ) && is_string( $param );
				},
			),
			'publishable_key' => array(
				'required'          => false,
				'type'              => 'string',
				'description'       => __( 'Stripe publishable key to validate (optional)', 'fair-payment' ),
				'validate_callback' => function( $param ) {
					return empty( $param ) || is_string( $param );
				},
			),
			'_wpnonce' => array(
				'required'    => true,
				'type'        => 'string',
				'description' => __( 'WordPress nonce for security', 'fair-payment' ),
			),
		);
	}

	/**
	 * Get payment status endpoint handler
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_payment_status( $request ) {
		$payment_id = $request->get_param( 'payment_id' );

		// Mock payment status for demo
		$status = $this->mock_payment_status( $payment_id );

		return new \WP_REST_Response(
			array(
				'success'    => true,
				'payment_id' => $payment_id,
				'status'     => $status,
				'message'    => $this->get_status_message( $status ),
				'timestamp'  => current_time( 'mysql' ),
			),
			200
		);
	}

	/**
	 * Mock payment status for demonstration
	 *
	 * @param string $payment_id Payment ID.
	 * @return string Payment status.
	 */
	private function mock_payment_status( $payment_id ) {
		$last_digit = substr( $payment_id, -1 );
		
		if ( in_array( $last_digit, array( '1', '2', '3', '4', '5', '6', '7' ), true ) ) {
			return 'completed';
		} elseif ( in_array( $last_digit, array( '8', '9' ), true ) ) {
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
				return __( 'Payment is being processed', 'fair-payment' );
			case 'failed':
				return __( 'Payment failed', 'fair-payment' );
			default:
				return __( 'Unknown payment status', 'fair-payment' );
		}
	}

	/**
	 * Localize API data for frontend JavaScript
	 *
	 * @return void
	 */
	public function localize_api_data() {
		// Only on pages that might use the API
		if ( is_admin() || is_page() || is_single() ) {
			wp_localize_script(
				'wp-api',
				'fairPaymentApi',
				array(
					'root'      => esc_url_raw( rest_url( self::NAMESPACE ) ),
					'nonce'     => wp_create_nonce( 'wp_rest' ),
					'endpoints' => array(
						'createCheckout'        => '/create-checkout',
						'createSimplePayment'   => '/create-simple-payment',
						'testStripeConnection'  => '/test-stripe-connection',
						'paymentStatus'         => '/payment-status',
					),
				)
			);
		}
	}
}