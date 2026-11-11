<?php
/**
 * Plugin Name: Fair E2E PHP Diagnostics Probe
 * Description: Test-only logging probe for the lifecycle runner's
 *              --php-diagnostics sweep (#2163). Loaded ONLY inside the
 *              Playwright wp-env instance (mounted via the `mappings` entry
 *              in .wp-env.json). Inert unless the sweep has set the
 *              FAIR_E2E_PHP_DIAGNOSTICS_TOKEN constant in wp-config.php and
 *              the request carries the same token in the
 *              X-Fair-PHP-Diagnostics-Probe header. Such a request raises one
 *              uniquely marked warning, which proves that diagnostics reach
 *              the collected log, and answers with the runtime versions.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

/**
 * Raise the probe warning and answer, for a request carrying the run's token.
 *
 * Runs as this file loads, before any plugin, so nothing else in the request
 * can log first or change the response.
 *
 * @return void
 */
function fair_e2e_php_diagnostics_probe() {
	if ( ! defined( 'FAIR_E2E_PHP_DIAGNOSTICS_TOKEN' ) || ! isset( $_SERVER['HTTP_X_FAIR_PHP_DIAGNOSTICS_PROBE'] ) ) {
		return;
	}

	$expected = (string) FAIR_E2E_PHP_DIAGNOSTICS_TOKEN;
	$received = sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_FAIR_PHP_DIAGNOSTICS_PROBE'] ) );
	if ( '' === $expected || ! hash_equals( $expected, $received ) ) {
		return;
	}

	// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_trigger_error -- the controlled warning is the point of the probe.
	trigger_error( esc_html( 'fair-php-diagnostics-probe:' . $expected ), E_USER_WARNING );

	wp_send_json(
		array(
			'probe'     => 'sent',
			'php'       => PHP_VERSION,
			'wordpress' => get_bloginfo( 'version' ),
		)
	);
}

fair_e2e_php_diagnostics_probe();
