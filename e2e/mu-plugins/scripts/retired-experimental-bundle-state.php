<?php
/**
 * Seed and report the state left behind by a removed experimental bundle
 * (Weekly Schedule, Image Templates).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/retired-experimental-bundle-state.php <bundle> <seed|revive|resave>
 *
 * - `seed` stores the features option as a site that had the bundle enabled
 *   left it, bypassing the sanitizer that would drop the key.
 * - `revive` forces the bundle on through its constant and the feature filter.
 * - `resave` writes the stored option back through the registered sanitizer,
 *   as a save on the settings page does.
 *
 * Prints a single `E2E_STATE:{json}` line.
 *
 * @package FairEventsE2E
 */

use FairAudienceExperimental\Core\Features;

defined( 'ABSPATH' ) || exit;

$state_bundle = isset( $args[0] ) ? (string) $args[0] : '';
$state_mode   = isset( $args[1] ) ? (string) $args[1] : '';

if ( ! in_array( $state_bundle, array( 'weekly-schedule', 'image-templates' ), true ) ) {
	WP_CLI::error( 'Unknown retired bundle: ' . $state_bundle );
}

if ( 'seed' === $state_mode ) {
	$stale = array( $state_bundle => true );
	foreach ( array_keys( Features::registry() ) as $key ) {
		$stale[ $key ] = true;
	}
	remove_all_filters( 'sanitize_option_' . Features::OPTION );
	update_option( Features::OPTION, $stale );
}

if ( 'revive' === $state_mode ) {
	define( 'FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_' . strtoupper( str_replace( '-', '_', $state_bundle ) ), true );
	add_filter( 'fair_audience_experimental_feature_enabled', '__return_true' );
}

if ( 'resave' === $state_mode ) {
	update_option( Features::OPTION, get_option( Features::OPTION ) );
}

echo 'E2E_STATE:' . wp_json_encode(
	array(
		'stored'     => get_option( Features::OPTION ),
		'enabled'    => Features::is_enabled( $state_bundle ),
		'forced'     => Features::is_forced( $state_bundle ),
		'inSnapshot' => array_key_exists( $state_bundle, Features::all() ),
	)
) . "\n";
