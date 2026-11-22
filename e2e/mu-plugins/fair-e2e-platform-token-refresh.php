<?php
/**
 * Plugin Name: Fair E2E platform token refresh
 * Description: Test-only Mollie token endpoint for the Fair Platform token
 *              refresh spec (#2380), loaded ONLY inside the Playwright
 *              wp-env instance.
 *
 * A request opts in with `X-Fair-E2E-Platform-Mollie-Refresh: <scenario>`;
 * requests without it are untouched. Only POSTs to
 * https://api.mollie.com/oauth2/tokens are answered:
 *
 *   keep             200 with a new access token and no refresh token
 *   rotate:<token>   200 with a new access token and refresh token <token>
 *   rejected         400 invalid_grant
 *   transport        a transport error
 *   invalid          200 without an access token
 *
 * Use together with `X-Fair-E2E-Platform-Credentials: set`
 * (fair-e2e-platform-health.php), which defines the client credentials.
 *
 * Mounted only into the wp-env tests instance via .wp-env.json — never
 * shipped.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- matched against fixed scenarios and a token pattern only.
$fair_e2e_platform_mollie_refresh = isset( $_SERVER['HTTP_X_FAIR_E2E_PLATFORM_MOLLIE_REFRESH'] ) ? (string) $_SERVER['HTTP_X_FAIR_E2E_PLATFORM_MOLLIE_REFRESH'] : '';

if ( '' !== $fair_e2e_platform_mollie_refresh ) {
	add_filter(
		'pre_http_request',
		static function ( $preempt, $args, $url ) use ( $fair_e2e_platform_mollie_refresh ) {
			if ( 'https://api.mollie.com/oauth2/tokens' !== $url || 'POST' !== ( $args['method'] ?? '' ) ) {
				return $preempt;
			}

			$respond = static function ( $code, $body ) {
				return array(
					'headers'  => array(),
					'body'     => wp_json_encode( $body ),
					'response' => array(
						'code'    => $code,
						'message' => '',
					),
					'cookies'  => array(),
					'filename' => null,
				);
			};

			$access = array(
				'access_token' => 'access_e2e_platform_' . wp_generate_password( 8, false ),
				'expires_in'   => 3600,
				'token_type'   => 'bearer',
			);

			if ( 'keep' === $fair_e2e_platform_mollie_refresh ) {
				return $respond( 200, $access );
			}
			if ( preg_match( '/^rotate:([A-Za-z0-9_]+)$/', $fair_e2e_platform_mollie_refresh, $matches ) ) {
				return $respond( 200, $access + array( 'refresh_token' => $matches[1] ) );
			}
			if ( 'rejected' === $fair_e2e_platform_mollie_refresh ) {
				return $respond(
					400,
					array(
						'error'             => 'invalid_grant',
						'error_description' => 'The refresh token is invalid.',
					)
				);
			}
			if ( 'transport' === $fair_e2e_platform_mollie_refresh ) {
				return new WP_Error( 'http_request_failed', 'Simulated Mollie outage.' );
			}
			if ( 'invalid' === $fair_e2e_platform_mollie_refresh ) {
				return $respond( 200, array( 'expires_in' => 3600 ) );
			}

			return new WP_Error( 'fair_e2e_unknown_scenario', 'Unknown Mollie refresh scenario.' );
		},
		10,
		3
	);
}
