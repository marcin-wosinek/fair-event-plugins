<?php
/**
 * Connection API Controller for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\API;

use FairPayment\Payment\MolliePaymentHandler;

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
			'fair-payment/v1',
			'/test-connection',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'test_connection' ),
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
	}

	/**
	 * Test Mollie connection and trigger token refresh
	 *
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function test_connection() {
		try {
			// Check if OAuth is configured
			if ( ! get_option( 'fair_payment_mollie_connected', false ) ) {
				return new \WP_Error(
					'not_connected',
					__( 'Mollie is not connected. Please connect your Mollie account first.', 'fair-payment' ),
					array( 'status' => 400 )
				);
			}

			// Get current token expiration
			$token_expires = get_option( 'fair_payment_mollie_token_expires', 0 );
			$expires_at    = $token_expires > 0 ? gmdate( 'Y-m-d H:i:s', $token_expires ) : 'unknown';

			error_log( '[Fair Payment] Test connection called. Token expires at: ' . $expires_at );

			// Try to create payment handler (will trigger token refresh if needed)
			$handler = new MolliePaymentHandler();

			// If we get here, connection is working
			$new_token_expires = get_option( 'fair_payment_mollie_token_expires', 0 );
			$new_expires_at    = $new_token_expires > 0 ? gmdate( 'Y-m-d H:i:s', $new_token_expires ) : 'unknown';

			// Check if token was refreshed
			$was_refreshed = $new_token_expires !== $token_expires;

			return new \WP_REST_Response(
				array(
					'success'         => true,
					'message'         => $was_refreshed
						? __( 'Connection test successful. Token was refreshed.', 'fair-payment' )
						: __( 'Connection test successful. Token is still valid.', 'fair-payment' ),
					'token_refreshed' => $was_refreshed,
					'token_expires'   => $new_token_expires,
					'expires_at'      => $new_expires_at,
				),
				200
			);

		} catch ( \Exception $e ) {
			error_log( '[Fair Payment] Test connection failed with exception: ' . $e->getMessage() );
			error_log( '[Fair Payment] Exception trace: ' . $e->getTraceAsString() );

			return new \WP_Error(
				'connection_failed',
				sprintf(
					/* translators: %s: error message */
					__( 'Connection test failed: %s', 'fair-payment' ),
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
