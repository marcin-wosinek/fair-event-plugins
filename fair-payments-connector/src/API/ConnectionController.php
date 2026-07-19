<?php
/**
 * Connection API Controller for Fair Payments Connector
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

use FairPaymentsConnector\Payment\MolliePaymentHandler;

defined( 'WPINC' ) || die;

/**
 * REST API controller for testing Mollie connection
 */
class ConnectionController extends \WP_REST_Controller {

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			'fair-payments-connector/v1',
			'/test-connection',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'test_connection' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);

		register_rest_route(
			'fair-payments-connector/v1',
			'/connection/overview',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_connection_overview' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
	}

	/**
	 * Get the connected Mollie profile name and enabled payment methods.
	 *
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function get_connection_overview() {
		if ( ! get_option( 'fair_payment_mollie_connected', false ) ) {
			return new \WP_Error(
				'not_connected',
				__( 'Mollie is not connected. Please connect your Mollie account first.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		try {
			$handler  = new MolliePaymentHandler();
			$overview = $handler->get_connection_overview();
		} catch ( \Exception $e ) {
			return new \WP_Error(
				'mollie_unreachable',
				$e->getMessage(),
				array( 'status' => 502 )
			);
		}

		$overview['manage_url'] = 'https://my.mollie.com/dashboard/';

		return new \WP_REST_Response( $overview, 200 );
	}

	/**
	 * Test Mollie connection and trigger token refresh
	 *
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function test_connection() {
		try {
			// Check if OAuth is configured.
			if ( ! get_option( 'fair_payment_mollie_connected', false ) ) {
				return new \WP_Error(
					'not_connected',
					__( 'Mollie is not connected. Please connect your Mollie account first.', 'fair-payments-connector' ),
					array( 'status' => 400 )
				);
			}

			// Get current token expiration.
			$token_expires = get_option( 'fair_payment_mollie_token_expires', 0 );

			// Try to create payment handler (will trigger token refresh if needed).
			$handler = new MolliePaymentHandler();

			// If we get here, connection is working.
			$new_token_expires = get_option( 'fair_payment_mollie_token_expires', 0 );
			$new_expires_at    = $new_token_expires > 0 ? gmdate( 'Y-m-d H:i:s', $new_token_expires ) : 'unknown';

			// Check if token was refreshed.
			$was_refreshed = $new_token_expires !== $token_expires;

			return new \WP_REST_Response(
				array(
					'success'         => true,
					'message'         => $was_refreshed
						? __( 'Connection test successful. Token was refreshed.', 'fair-payments-connector' )
						: __( 'Connection test successful. Token is still valid.', 'fair-payments-connector' ),
					'token_refreshed' => $was_refreshed,
					'token_expires'   => $new_token_expires,
					'expires_at'      => $new_expires_at,
				),
				200
			);

		} catch ( \Exception $e ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[Fair Payments Connector] Test connection failed: ' . $e->getMessage() . "\n" . $e->getTraceAsString() );
			}

			return new \WP_Error(
				'connection_failed',
				sprintf(
					/* translators: %s: error message */
					__( 'Connection test failed: %s', 'fair-payments-connector' ),
					$e->getMessage()
				),
				array(
					'status'  => 500,
					'details' => array(
						'message' => $e->getMessage(),
						'code'    => $e->getCode(),
						'file'    => basename( $e->getFile() ),
						'line'    => $e->getLine(),
					),
				)
			);
		}
	}
}
