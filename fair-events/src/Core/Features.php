<?php
/**
 * Feature flag registry for Fair Events.
 *
 * Central, fine-grained gate that lets the plugin ship a clean public build
 * while keeping the full internal build active on sites the maintainer
 * controls. Registration points (REST controllers, admin pages, blocks,
 * frontend hooks) consult {@see Features::is_enabled()} so advanced or
 * less-tested bundles can default off for public installs and on under the
 * `FAIR_EVENTS_INTERNAL` master switch.
 *
 * @package FairEvents
 */

namespace FairEvents\Core;

use FairEventsShared\FeatureFlags;

defined( 'WPINC' ) || die;

/**
 * Feature flag registry.
 *
 * Resolution for is_enabled(), implemented by
 * {@see \FairEventsShared\FeatureFlags}:
 *
 *   1. Per-feature constant `FAIR_EVENTS_FEATURE_<UPPER>` (true/false) wins outright;
 *      the filter is not applied.
 *   2. Master switch `FAIR_EVENTS_INTERNAL` (strictly true) → enabled; otherwise
 *      the stored option `fair_events_features` ([ key => bool ]) from the
 *      Settings UI, then the hardcoded default in the registry below.
 *   3. `fair_events_feature_enabled` filter receives the step-2 result and has the
 *      last word — it can override the master switch, although
 *      is_forced() still reports the key as forced.
 *
 * `core` is not a flag — it is always on. It is listed in all() only so the
 * Settings UI can describe it alongside the rest.
 */
class Features {

	/**
	 * Option key holding user-toggled feature state.
	 */
	public const OPTION = 'fair_events_features';

	/**
	 * Master switch constant. When defined and truthy, every internal-bundle
	 * default flips to true — the single line a maintainer adds in
	 * wp-config.php (or via deploy) to get the full build.
	 */
	public const MASTER_CONSTANT = 'FAIR_EVENTS_INTERNAL';

	/**
	 * Canonical bundle registry.
	 *
	 * Labels/descriptions are intentionally untranslated here: `registry()` is
	 * consulted by `is_enabled()` during plugin bootstrap (before WordPress's
	 * `init` action fires), and calling `__()` that early triggers the
	 * `_load_textdomain_just_in_time` notice in WP 6.7+. Translation is
	 * applied in {@see self::all()}, which only runs in admin REST contexts.
	 *
	 * @return array<string,array{label:string,description:string,default:bool,always_on?:bool}>
	 */
	public static function registry() {
		return array(
			'core'                 => array(
				'label'       => 'Core',
				'description' => 'Events, calendar, all-events, settings, core blocks. Always on.',
				'default'     => true,
				'always_on'   => true,
			),
			'venues'               => array(
				'label'       => 'Venues',
				'description' => 'Venues admin page and REST controller. Always on.',
				'default'     => true,
				'always_on'   => true,
			),
			'bundled-translations' => array(
				'label'       => 'Bundled translations',
				'description' => 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs. Useful while a locale is below the 90% threshold on translate.wordpress.org or for in-progress strings.',
				'default'     => false,
				'central'     => true,
			),
			'ticketing'            => array(
				'label'       => 'Ticketing',
				'description' => 'Ticket types, sale periods, and pricing.',
				'default'     => true,
			),
		);
	}

	/**
	 * Path passed to wp_set_script_translations() for the bundled-translations
	 * opt-in. When the flag is off, returns null so core resolves JSON from the
	 * WP.org language-pack location.
	 *
	 * @return string|null
	 */
	public static function script_translations_path() {
		return self::is_enabled( 'bundled-translations' )
			? FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			: null;
	}

	/**
	 * Resolve whether a feature bundle is enabled. Unknown keys resolve to
	 * false (fail-closed).
	 *
	 * @param string $key Bundle key from registry().
	 * @return bool
	 */
	public static function is_enabled( $key ) {
		return self::flags()->is_enabled( $key );
	}

	/**
	 * Whether the resolved value is forced (always-on, a per-feature
	 * constant, or the master switch) — used by the Settings UI to render the
	 * toggle disabled and by the option sanitizer so a UI write cannot
	 * override wp-config.
	 *
	 * @param string $key Bundle key.
	 * @return bool
	 */
	public static function is_forced( $key ) {
		return self::flags()->is_forced( $key );
	}

	/**
	 * Full snapshot for the Settings UI: registry entries + resolved state.
	 *
	 * @return array<string,array{label:string,description:string,default:bool,always_on:bool,enabled:bool,forced:bool}>
	 */
	public static function all() {
		$out = array();
		// Translation happens here (not in `registry()`) so the textdomain is
		// only loaded when a consumer needs labels — by then `init` has fired.
		// Literal strings are required for makepot extraction; the registry's
		// raw values are kept in sync with these and serve as fallback.
		$translated = array(
			'core'                 => array(
				'label'       => __( 'Core', 'fair-events' ),
				'description' => __( 'Events, calendar, all-events, settings, core blocks. Always on.', 'fair-events' ),
			),
			'venues'               => array(
				'label'       => __( 'Venues', 'fair-events' ),
				'description' => __( 'Venues admin page and REST controller. Always on.', 'fair-events' ),
			),
			'bundled-translations' => array(
				'label'       => __( 'Bundled translations', 'fair-events' ),
				'description' => __( 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs. Useful while a locale is below the 90% threshold on translate.wordpress.org or for in-progress strings.', 'fair-events' ),
			),
			'ticketing'            => array(
				'label'       => __( 'Ticketing', 'fair-events' ),
				'description' => __( 'Ticket types, sale periods, and pricing.', 'fair-events' ),
			),
		);

		foreach ( self::registry() as $key => $entry ) {
			$out[ $key ] = array(
				'label'       => $translated[ $key ]['label'] ?? $entry['label'],
				'description' => $translated[ $key ]['description'] ?? $entry['description'],
				'default'     => (bool) $entry['default'],
				'always_on'   => ! empty( $entry['always_on'] ),
				'central'     => ! empty( $entry['central'] ),
				'enabled'     => self::is_enabled( $key ),
				'forced'      => self::is_forced( $key ),
			);
		}
		return $out;
	}

	/**
	 * Compact `[ key => bool ]` map of resolved feature state. Injected into
	 * the manage-event page so React can hide tabs without re-querying REST.
	 *
	 * @return array<string,bool>
	 */
	public static function public_map() {
		$out = array();
		foreach ( array_keys( self::registry() ) as $key ) {
			$out[ $key ] = self::is_enabled( $key );
		}
		return $out;
	}

	/**
	 * Sanitize an option payload to the known key set. Forced keys keep their
	 * stored value (so a UI write cannot contradict a wp-config decision) and
	 * known keys omitted from the payload keep their existing value.
	 *
	 * @param mixed $value Raw option value.
	 * @return array<string,bool>
	 */
	public static function sanitize_option( $value ) {
		return self::flags()->sanitize_option( $value );
	}

	/**
	 * Shared resolver configured with this plugin's registry, option,
	 * constants, and filter. Built per call so nothing is cached.
	 *
	 * @return FeatureFlags
	 */
	private static function flags() {
		return new FeatureFlags(
			self::registry(),
			self::OPTION,
			'FAIR_EVENTS_FEATURE_',
			self::MASTER_CONSTANT,
			'fair_events_feature_enabled'
		);
	}
}
