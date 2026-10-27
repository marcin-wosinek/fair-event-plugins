<?php
/**
 * Plugin Name: Fair Demo safety
 * Description: Local demo only. Suppresses outgoing email, refuses outgoing HTTP requests except WordPress.org and the site itself, and pauses cron while the demo is being provisioned.
 *
 * Installed into the Docker Compose demo site by `npm run demo:reset`
 * (scripts/reset-demo.mjs), which uses fixed, public credentials and a real
 * address as the site email. Nothing the demo does may send mail, initiate a
 * payment or reach a messaging service. Unlike e2e/mu-plugins, it adds no
 * test routes or fake integrations. Never shipped.
 *
 * @package FairEventsDemo
 */

defined( 'ABSPATH' ) || exit;

/**
 * Flag file the reset script creates before provisioning and removes once the
 * baseline is verified. A failed reset leaves it in place, so cron stays off.
 */
const FAIR_DEMO_PROVISIONING_FLAG = WP_CONTENT_DIR . '/fair-demo-provisioning.flag';

/**
 * Hosts the demo may reach: WordPress.org, for language packs, and the site
 * itself, for loopback requests.
 *
 * @return string[]
 */
function fair_demo_allowed_hosts() {
	return array(
		'api.wordpress.org',
		'downloads.wordpress.org',
		'localhost',
		'127.0.0.1',
		wp_parse_url( home_url(), PHP_URL_HOST ),
	);
}

add_filter( 'pre_wp_mail', '__return_false', PHP_INT_MAX );

add_filter(
	'pre_http_request',
	static function ( $preempt, $parsed_args, $url ) {
		if ( false !== $preempt ) {
			return $preempt;
		}

		$host = wp_parse_url( $url, PHP_URL_HOST );
		if ( in_array( $host, fair_demo_allowed_hosts(), true ) ) {
			return $preempt;
		}

		return new WP_Error( 'fair_demo_http_blocked', sprintf( 'Outgoing request to %s blocked by the demo safety plugin.', $host ) );
	},
	PHP_INT_MAX,
	3
);

if ( file_exists( FAIR_DEMO_PROVISIONING_FLAG ) ) {
	remove_action( 'init', 'wp_cron' );
	add_filter( 'pre_get_ready_cron_jobs', '__return_empty_array' );
}
