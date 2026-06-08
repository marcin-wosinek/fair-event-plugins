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

defined( 'WPINC' ) || die;

/**
 * Feature flag registry.
 *
 * Resolution order for is_enabled() (first match wins):
 *
 *   1. Per-feature constant `FAIR_EVENTS_FEATURE_<UPPER>` (true/false).
 *   2. Master switch `FAIR_EVENTS_INTERNAL` (true → every internal bundle on).
 *   3. `fair_events_feature_enabled` filter (programmatic / tests).
 *   4. Stored option `fair_events_features` ([ key => bool ]) from Settings UI.
 *   5. Hardcoded default in the registry below.
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
				'description' => 'Venues admin page and REST controller.',
				'default'     => false,
			),
			'sources'              => array(
				'label'       => 'Event sources & feeds',
				'description' => 'External event sources, Facebook import, iCal/JSON feeds, event proposals, weekly schedule.',
				'default'     => false,
			),
			'galleries'            => array(
				'label'       => 'Galleries',
				'description' => 'Per-event photo galleries, photo likes/downloads, image exports, media library hooks.',
				'default'     => false,
			),
			'ticketing'            => array(
				'label'       => 'Ticketing',
				'description' => 'Tickets, group pricing/permission rules, invitations. Requires fair-audience.',
				'default'     => false,
			),
			'event-tools'          => array(
				'label'       => 'Event tools',
				'description' => 'Event duplication, merge, and admin-bar Copy button.',
				'default'     => false,
			),
			'migration'            => array(
				'label'       => 'Migration',
				'description' => 'One-time post → event migration tooling.',
				'default'     => false,
			),
			'bundled-translations' => array(
				'label'       => 'Bundled translations',
				'description' => 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs. Useful while a locale is below the 90% threshold on translate.wordpress.org or for in-progress strings.',
				'default'     => false,
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
	 * Resolve whether a feature bundle is enabled.
	 *
	 * Unknown keys resolve to false (fail-closed).
	 *
	 * @param string $key Bundle key from registry().
	 * @return bool
	 */
	public static function is_enabled( $key ) {
		$registry = self::registry();
		if ( ! isset( $registry[ $key ] ) ) {
			return false;
		}

		if ( ! empty( $registry[ $key ]['always_on'] ) ) {
			return true;
		}

		// 1. Per-feature constant always wins.
		$constant = self::feature_constant_name( $key );
		if ( defined( $constant ) ) {
			return (bool) constant( $constant );
		}

		// 2. Master internal switch flips every non-core bundle on.
		if ( defined( self::MASTER_CONSTANT ) && true === constant( self::MASTER_CONSTANT ) ) {
			$enabled = true;
		} else {
			// 4. Stored option, then 5. hardcoded default.
			$stored  = get_option( self::OPTION, array() );
			$enabled = is_array( $stored ) && array_key_exists( $key, $stored )
				? (bool) $stored[ $key ]
				: (bool) $registry[ $key ]['default'];
		}

		// 3. Filter runs after constants so tests/extensions can override
		// stored/default state without fighting a wp-config decision.
		return (bool) apply_filters( 'fair_events_feature_enabled', $enabled, $key );
	}

	/**
	 * Whether the resolved value is forced by a constant — used by the
	 * Settings UI to render the toggle disabled and ignored by the option
	 * sanitizer so a UI write cannot override wp-config.
	 *
	 * @param string $key Bundle key.
	 * @return bool
	 */
	public static function is_forced( $key ) {
		$registry = self::registry();
		if ( ! isset( $registry[ $key ] ) ) {
			return false;
		}

		if ( ! empty( $registry[ $key ]['always_on'] ) ) {
			return true;
		}

		if ( defined( self::feature_constant_name( $key ) ) ) {
			return true;
		}

		return defined( self::MASTER_CONSTANT ) && true === constant( self::MASTER_CONSTANT );
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
				'description' => __( 'Venues admin page and REST controller.', 'fair-events' ),
			),
			'sources'              => array(
				'label'       => __( 'Event sources & feeds', 'fair-events' ),
				'description' => __( 'External event sources, Facebook import, iCal/JSON feeds, event proposals, weekly schedule.', 'fair-events' ),
			),
			'galleries'            => array(
				'label'       => __( 'Galleries', 'fair-events' ),
				'description' => __( 'Per-event photo galleries, photo likes/downloads, image exports, media library hooks.', 'fair-events' ),
			),
			'ticketing'            => array(
				'label'       => __( 'Ticketing', 'fair-events' ),
				'description' => __( 'Tickets, group pricing/permission rules, invitations. Requires fair-audience.', 'fair-events' ),
			),
			'event-tools'          => array(
				'label'       => __( 'Event tools', 'fair-events' ),
				'description' => __( 'Event duplication, merge, and admin-bar Copy button.', 'fair-events' ),
			),
			'migration'            => array(
				'label'       => __( 'Migration', 'fair-events' ),
				'description' => __( 'One-time post → event migration tooling.', 'fair-events' ),
			),
			'bundled-translations' => array(
				'label'       => __( 'Bundled translations', 'fair-events' ),
				'description' => __( 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs. Useful while a locale is below the 90% threshold on translate.wordpress.org or for in-progress strings.', 'fair-events' ),
			),
		);

		foreach ( self::registry() as $key => $entry ) {
			$out[ $key ] = array(
				'label'       => $translated[ $key ]['label'] ?? $entry['label'],
				'description' => $translated[ $key ]['description'] ?? $entry['description'],
				'default'     => (bool) $entry['default'],
				'always_on'   => ! empty( $entry['always_on'] ),
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
	 * Sanitize an option payload to the known key set, dropping forced keys
	 * (so a UI write cannot contradict a wp-config decision).
	 *
	 * @param mixed $value Raw option value.
	 * @return array<string,bool>
	 */
	public static function sanitize_option( $value ) {
		if ( ! is_array( $value ) ) {
			return array();
		}

		$existing = get_option( self::OPTION, array() );
		if ( ! is_array( $existing ) ) {
			$existing = array();
		}

		$registry = self::registry();
		$out      = array();
		foreach ( $registry as $key => $entry ) {
			if ( ! empty( $entry['always_on'] ) ) {
				continue;
			}

			if ( self::is_forced( $key ) ) {
				// Preserve the existing stored value but never let a forced
				// key be rewritten from the UI.
				if ( array_key_exists( $key, $existing ) ) {
					$out[ $key ] = (bool) $existing[ $key ];
				}
				continue;
			}

			if ( array_key_exists( $key, $value ) ) {
				$out[ $key ] = (bool) $value[ $key ];
			} elseif ( array_key_exists( $key, $existing ) ) {
				$out[ $key ] = (bool) $existing[ $key ];
			}
		}
		return $out;
	}

	/**
	 * Per-feature constant name (e.g. `galleries` → `FAIR_EVENTS_FEATURE_GALLERIES`).
	 *
	 * @param string $key Bundle key.
	 * @return string
	 */
	private static function feature_constant_name( $key ) {
		return 'FAIR_EVENTS_FEATURE_' . strtoupper( str_replace( '-', '_', $key ) );
	}
}
