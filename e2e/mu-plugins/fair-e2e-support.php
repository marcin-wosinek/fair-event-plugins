<?php
/**
 * Plugin Name: Fair Events E2E Support
 * Description: Test-only helpers loaded ONLY inside the Playwright wp-env
 *              instance (mounted via the `mappings` entry in .wp-env.json).
 *              Never shipped to production and never mounted by the dev
 *              `docker compose` stack.
 *
 * It does three things, all confined to the test environment:
 *
 *   1. Captures outgoing mail into the `fair_e2e_captured_mail` option instead
 *      of sending it, so specs can assert on subject/recipient/body and no real
 *      mail leaves the host.
 *   2. Forces fair-payment into Mollie "test" mode with a dummy key, so the
 *      production Mollie code path runs without a real API key.
 *   3. Pre-declares a fake Mollie HTTP transport (see lib/mollie-http-double.php)
 *      so every Mollie API call returns canned responses. This keeps ALL of the
 *      real fair-payment / fair-audience purchase code in play while making the
 *      "payment" deterministic and offline.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

/*
 * 1. Intercept the Mollie HTTP transport.
 *
 * Declared at mu-plugin load time — before fair-payment's Composer autoloader
 * gets a chance to load the vendored CurlMollieHttpAdapter — so the SDK's
 * adapter picker instantiates our double instead. The real MollieApiClient
 * (URL building, response parsing, resource hydration) is untouched.
 */
require_once __DIR__ . '/lib/mollie-http-double.php';

/*
 * 2. Force fair-payment into test mode with a syntactically valid dummy key.
 *
 * MollieApiClient::setApiKey() requires `^(live|test)_\w{30,}$`. The double
 * ignores the key, but the real handler still validates it before use, so it
 * must look real.
 */
add_filter(
	'pre_option_fair_payment_test_api_key',
	static function () {
		return 'test_' . str_repeat( 'e', 30 );
	}
);
add_filter(
	'pre_option_fair_payment_mode',
	static function () {
		return 'test';
	}
);

/*
 * 3. Capture mail instead of sending it.
 *
 * Returning a non-null value from `pre_wp_mail` short-circuits wp_mail() (so
 * nothing is dispatched) and becomes its return value. We log each message to
 * an option the specs read via WP-CLI.
 */
add_filter(
	'pre_wp_mail',
	static function ( $short_circuit, $atts ) {
		$log   = get_option( 'fair_e2e_captured_mail', array() );
		$log[] = array(
			'to'      => isset( $atts['to'] ) ? $atts['to'] : '',
			'subject' => isset( $atts['subject'] ) ? $atts['subject'] : '',
			'body'    => isset( $atts['message'] ) ? $atts['message'] : '',
			'headers' => isset( $atts['headers'] ) ? $atts['headers'] : '',
			'time'    => time(),
		);
		update_option( 'fair_e2e_captured_mail', $log, false );

		return true;
	},
	10,
	2
);
