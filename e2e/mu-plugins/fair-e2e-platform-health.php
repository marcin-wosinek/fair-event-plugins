<?php
/**
 * Plugin Name: Fair E2E platform health
 * Description: Test-only controls for the Fair Platform health spec (#2290),
 *              loaded ONLY inside the Playwright wp-env instance.
 *
 * A request opts in with headers; requests without them are untouched:
 *
 * - `X-Fair-E2E-Platform-Credentials: set|empty` defines the Mollie client
 *   credential constants for this request, with fixed test values or as
 *   empty strings. The test site has none otherwise.
 * - `X-Fair-E2E-Platform-Outbound: 1` refuses every outgoing HTTP request
 *   and names its host in an `X-Fair-E2E-Outbound-Http` response header, so
 *   a spec can prove a request made no outbound call.
 *
 * Mounted only into the wp-env tests instance via .wp-env.json — never
 * shipped.
 *
 * @package FairE2E
 */

defined( 'ABSPATH' ) || die;

// phpcs:disable WordPress.Security.ValidatedSanitizedInput -- compared against fixed values only.
$fair_e2e_platform_credentials = isset( $_SERVER['HTTP_X_FAIR_E2E_PLATFORM_CREDENTIALS'] ) ? (string) $_SERVER['HTTP_X_FAIR_E2E_PLATFORM_CREDENTIALS'] : '';
$fair_e2e_platform_outbound    = ! empty( $_SERVER['HTTP_X_FAIR_E2E_PLATFORM_OUTBOUND'] );
// phpcs:enable

if ( 'set' === $fair_e2e_platform_credentials && ! defined( 'MOLLIE_CLIENT_ID' ) ) {
	define( 'MOLLIE_CLIENT_ID', 'app_e2e_health_client' );
	define( 'MOLLIE_CLIENT_SECRET', 'e2e_health_secret' );
} elseif ( 'empty' === $fair_e2e_platform_credentials && ! defined( 'MOLLIE_CLIENT_ID' ) ) {
	define( 'MOLLIE_CLIENT_ID', '' );
	define( 'MOLLIE_CLIENT_SECRET', '' );
}

if ( $fair_e2e_platform_outbound ) {
	add_filter(
		'pre_http_request',
		static function ( $preempt, $args, $url ) {
			unset( $preempt, $args );
			$host = (string) wp_parse_url( $url, PHP_URL_HOST );
			if ( ! headers_sent() ) {
				header( 'X-Fair-E2E-Outbound-Http: ' . preg_replace( '/[^a-z0-9.\-]/i', '', $host ), false );
			}
			return new WP_Error( 'fair_e2e_outbound_refused', 'Outgoing request refused by the platform health fixture.' );
		},
		PHP_INT_MIN,
		3
	);
}
