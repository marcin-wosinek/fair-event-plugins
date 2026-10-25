<?php
/**
 * Plugin Name: Fair Payments E2E Error Responses
 * Description: Test-only support for the error response specs (#860), loaded
 *              ONLY inside the Playwright wp-env instance. Makes a connection
 *              test or webhook request fail with a recognizable exception,
 *              and reports whether the site runs with WP_DEBUG.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

/*
 * A request to one of these routes carrying X-Fair-E2E-Fail-Diagnostic fails
 * inside the handler's try block: reading the Mollie token expiry throws an
 * exception whose message is the header value. Both handlers read it after
 * their input checks, the webhook once it has found the transaction.
 */
add_filter(
	'rest_request_before_callbacks',
	static function ( $response, $handler, WP_REST_Request $request ) {
		$routes     = array( '/fair-payments-connector/v1/test-connection', '/fair-payments-connector/v1/webhook' );
		$diagnostic = (string) $request->get_header( 'X-Fair-E2E-Fail-Diagnostic' );

		if ( '' !== $diagnostic && in_array( $request->get_route(), $routes, true ) ) {
			add_filter(
				'pre_option_fair_payment_mollie_token_expires',
				static function () use ( $diagnostic ) {
					throw new RuntimeException( $diagnostic ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- test-only exception.
				},
				20
			);
		}

		return $response;
	},
	10,
	3
);

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'fair-e2e/v1',
			'/error-responses',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => static function () {
					return rest_ensure_response( array( 'wp_debug' => defined( 'WP_DEBUG' ) && WP_DEBUG ) );
				},
			)
		);
	}
);
