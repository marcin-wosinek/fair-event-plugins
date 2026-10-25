<?php
/**
 * Plugin Name: Fair E2E external HTTP guard
 * Description: Test-only. While the `fair_e2e_block_external_http` option is set, refuses every outgoing WordPress HTTP request to a non-local host.
 *
 * The Manage Event screenshot run (#2043) turns the option on before it seeds
 * its demo, so nothing it renders can reach a payment provider, a messaging
 * service or any other remote host. Requests another test double already
 * answered pass through unchanged; only real network calls are refused.
 *
 * Mounted only into the wp-env tests instance via .wp-env.json — never
 * shipped.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether outgoing requests to non-local hosts are currently refused.
 *
 * @return bool
 */
function fair_e2e_external_http_blocked() {
	return (bool) get_option( 'fair_e2e_block_external_http' );
}

add_filter(
	'pre_http_request',
	static function ( $preempt, $parsed_args, $url ) {
		if ( false !== $preempt || ! fair_e2e_external_http_blocked() ) {
			return $preempt;
		}

		$host = wp_parse_url( $url, PHP_URL_HOST );
		if ( in_array( $host, array( 'localhost', '127.0.0.1', wp_parse_url( home_url(), PHP_URL_HOST ) ), true ) ) {
			return $preempt;
		}

		return new WP_Error( 'fair_e2e_external_http_blocked', sprintf( 'Outgoing request to %s blocked by the E2E external HTTP guard.', $host ) );
	},
	PHP_INT_MAX,
	3
);
