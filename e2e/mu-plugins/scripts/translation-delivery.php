<?php
/**
 * Switch the site language and how a plugin's translations reach it.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/translation-delivery.php <mode> [locale] [plugin]
 *
 * The plugin defaults to fair-events; it must have a bundled-translations
 * flag stored in its `fair_{plugin}_features` option.
 *
 * Modes:
 *   language-pack  Copy the plugin's own .mo and build/languages JSON for the
 *                  locale into wp-content/languages/plugins/, where WordPress
 *                  core finds WordPress.org language packs, with the
 *                  bundled-translations flag off.
 *   bundled        Leave wp-content/languages/plugins/ empty and turn the
 *                  bundled-translations flag on.
 *   reset          English site, flag off, copied language-pack files removed.
 *
 * The locale is set through the WPLANG option, which core reads without a
 * core language pack, so admin chrome stays English while plugin strings
 * follow the selected delivery path. Saving the option still runs core's
 * sanitizer, which drops a locale missing from get_available_languages(),
 * so the script keeps the requested value for this one save.
 *
 * Prints a single `E2E_TRANSLATIONS:{json}` line.
 *
 * @package FairEventsE2E
 */

$delivery_mode = isset( $args[0] ) ? $args[0] : '';
$target_locale = isset( $args[1] ) ? $args[1] : 'es_ES';
$plugin_slug   = isset( $args[2] ) ? $args[2] : 'fair-events';

$feature_options = array(
	'fair-events'  => 'fair_events_features',
	'fair-finance' => 'fair_finance_features',
);

if ( ! in_array( $delivery_mode, array( 'language-pack', 'bundled', 'reset' ), true ) ) {
	WP_CLI::error( 'Usage: translation-delivery.php <language-pack|bundled|reset> [locale] [plugin]' );
}
if ( ! isset( $feature_options[ $plugin_slug ] ) ) {
	WP_CLI::error( 'Unsupported plugin: ' . $plugin_slug );
}
if ( ! preg_match( '/^[a-z]{2,3}(_[A-Z]{2})?$/', $target_locale ) ) {
	WP_CLI::error( 'Invalid locale.' );
}

$plugin_dir = WP_PLUGIN_DIR . '/' . $plugin_slug;
$pack_dir   = WP_LANG_DIR . '/plugins';

// Remove files copied by an earlier language-pack run, for any locale.
$removed = 0;
$copies  = array_merge(
	(array) glob( $pack_dir . "/{$plugin_slug}-*.mo" ),
	(array) glob( $pack_dir . "/{$plugin_slug}-*.json" )
);
foreach ( $copies as $file ) {
	if ( wp_delete_file( $file ) || ! file_exists( $file ) ) {
		++$removed;
	}
}

$copied = 0;
if ( 'language-pack' === $delivery_mode ) {
	wp_mkdir_p( $pack_dir );
	$sources = array_merge(
		array( $plugin_dir . "/languages/{$plugin_slug}-{$target_locale}.mo" ),
		(array) glob( $plugin_dir . "/build/languages/{$plugin_slug}-{$target_locale}-*.json" )
	);
	foreach ( $sources as $source ) {
		if ( is_file( $source ) && copy( $source, $pack_dir . '/' . basename( $source ) ) ) {
			++$copied;
		}
	}
	if ( $copied < 2 ) {
		WP_CLI::error( "No built {$target_locale} catalog to copy; run makemo and build first." );
	}
}

$features                         = (array) get_option( $feature_options[ $plugin_slug ], array() );
$features['bundled-translations'] = ( 'bundled' === $delivery_mode );
update_option( $feature_options[ $plugin_slug ], $features );
// No core language pack is installed on the tests site; keep the locale anyway.
$keep_locale = static function ( $value, $option, $original_value ) {
	return $original_value;
};
add_filter( 'sanitize_option_WPLANG', $keep_locale, 10, 3 );
update_option( 'WPLANG', 'reset' === $delivery_mode ? '' : $target_locale );
remove_filter( 'sanitize_option_WPLANG', $keep_locale, 10 );

echo 'E2E_TRANSLATIONS:' . wp_json_encode(
	array(
		'plugin'  => $plugin_slug,
		'mode'    => $delivery_mode,
		'locale'  => 'reset' === $delivery_mode ? '' : $target_locale,
		'copied'  => $copied,
		'removed' => $removed,
	)
) . "\n";
