<?php
/**
 * Switch the site timezone for a spec and report the previous setting so the
 * spec can restore it afterwards.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/set-site-timezone.php <timezoneString|-> [gmtOffset]
 *
 * `-` clears the timezone string, for restoring a UTC-offset-only setup.
 *
 * Prints a single `E2E_SITE_TIMEZONE:{json}` line with the previous values.
 *
 * @package FairFormE2E
 */

defined( 'ABSPATH' ) || exit;

$timezone_string = isset( $args[0] ) ? (string) $args[0] : '';
if ( '' === $timezone_string ) {
	WP_CLI::error( 'Usage: set-site-timezone.php <timezoneString|-> [gmtOffset]' );
}

$previous = array(
	'timezoneString' => (string) get_option( 'timezone_string', '' ),
	'gmtOffset'      => (string) get_option( 'gmt_offset', '0' ),
);

update_option( 'timezone_string', '-' === $timezone_string ? '' : $timezone_string );
if ( isset( $args[1] ) ) {
	update_option( 'gmt_offset', $args[1] );
}

echo 'E2E_SITE_TIMEZONE:' . wp_json_encode( $previous ) . "\n";
