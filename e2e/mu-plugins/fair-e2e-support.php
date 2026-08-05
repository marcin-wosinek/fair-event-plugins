<?php
/**
 * Plugin Name: Fair Events E2E Support
 * Description: Test-only helpers loaded ONLY inside the Playwright wp-env
 *              instance (mounted via the `mappings` entry in .wp-env.json).
 *              Never shipped to production and never mounted by the dev
 *              `docker compose` stack.
 *
 * It does four things, all confined to the test environment:
 *
 *   1. Captures outgoing mail into the `fair_e2e_captured_mail` option instead
 *      of sending it, so specs can assert on subject/recipient/body and no real
 *      mail leaves the host.
 *   2. Forces fair-payments-connector into Mollie "test" mode with a fake OAuth
 *      connection, so the production Mollie code path runs without a real
 *      Mollie account. (API key authentication was retired in #1317 — there
 *      is no key-based fallback left to fake.)
 *   3. Pre-declares a fake Mollie HTTP transport (see lib/mollie-http-double.php)
 *      so every Mollie API call returns canned responses. This keeps ALL of the
 *      real fair-payments-connector / fair-audience purchase code in play while making the
 *      "payment" deterministic and offline.
 *   4. Bypasses GetTicketsController's per-IP rate limit, which a full API/E2E
 *      test run exhausts well before it finishes (every spec run shares one
 *      source IP).
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

/*
 * 0. Force fair-form's bundled-translations flag from an option, so specs can
 *    exercise the central Fair Event Plugins settings screen's "locked by a
 *    wp-config constant" behavior without restarting PHP between requests —
 *    each request re-reads the option and (re)defines the constant.
 */
if ( get_option( 'fair_e2e_force_form_bundled_translations' ) ) {
	define( 'FAIR_FORM_FEATURE_BUNDLED_TRANSLATIONS', true );
}

/*
 * 1. Intercept the Mollie HTTP transport.
 *
 * Hooks into plugins_loaded (priority 1) — after fair-payments-connector has
 * registered its Composer autoloader (so SDK traits/interfaces are resolvable)
 * but before any REST request triggers new MollieApiClient() (which is the
 * earliest the adapter picker could instantiate the vendored class). Declaring
 * our double at that point is enough to shadow the final class.
 */
\add_action(
	'plugins_loaded',
	static function () {
		require_once __DIR__ . '/lib/mollie-http-double.php';
	},
	1
);

/*
 * 2. Force fair-payments-connector into test mode with a fake OAuth connection.
 *
 * MolliePaymentHandler::is_configured() and its constructor only ever consult
 * the OAuth option set — there is no API-key fallback since #1317 — so the
 * double needs a connected-looking site: a truthy `_connected` flag, a
 * profile ID (used for the payment/method-allowlist calls), a syntactically
 * plausible access token, and an expiry far enough in the future that
 * get_valid_access_token() never calls the real, un-doubled
 * `https://fair-event-plugins.com/oauth/refresh`.
 */
add_filter(
	'pre_option_fair_payment_mollie_connected',
	static function () {
		return true;
	}
);
add_filter(
	'pre_option_fair_payment_mollie_profile_id',
	static function () {
		return 'pfl_e2e0000000';
	}
);
add_filter(
	'pre_option_fair_payment_mollie_access_token',
	static function () {
		return 'access_e2e_' . str_repeat( 'e', 30 );
	}
);
add_filter(
	'pre_option_fair_payment_mollie_token_expires',
	static function () {
		return time() + YEAR_IN_SECONDS;
	}
);
add_filter(
	'pre_option_fair_payment_mode',
	static function () {
		return 'test';
	}
);

/*
 * 3. Bypass GetTicketsController's per-IP rate limit (20 requests/hour in
 *    production). A full test run drives far more than that many real
 *    signups through the public get-tickets endpoint from the CI runner's
 *    single IP, which would otherwise fail later specs with 429s unrelated
 *    to what they're testing. The per-email limit is left untouched — it's
 *    what EventSignupHookBridge.api.spec.js (#1245) exercises directly.
 */
add_filter( 'fair_events_get_tickets_rate_limit_bypass_ip', '__return_true' );

/*
 * 4. Capture mail instead of sending it.
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
