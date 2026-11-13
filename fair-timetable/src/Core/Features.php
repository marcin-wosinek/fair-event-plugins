<?php
/**
 * Feature flag registry for Fair Timetable.
 *
 * @package FairTimetable
 */

namespace FairTimetable\Core;

use FairEventsShared\FeatureFlags;

defined( 'WPINC' ) || die;

/**
 * Feature flag registry.
 *
 * Resolution for is_enabled(), implemented by
 * {@see \FairEventsShared\FeatureFlags}:
 *
 *   1. Per-feature constant `FAIR_TIMETABLE_FEATURE_<UPPER>` (true/false) wins outright;
 *      the filter is not applied.
 *   2. Master switch `FAIR_TIMETABLE_INTERNAL` (strictly true) → enabled; otherwise
 *      the stored option `fair_timetable_features` ([ key => bool ]) from the
 *      Settings UI, then the hardcoded default in the registry below.
 *   3. `fair_timetable_feature_enabled` filter receives the step-2 result and has the
 *      last word — it can override the master switch, although
 *      is_forced() still reports the key as forced.
 */
class Features {

	public const OPTION = 'fair_timetable_features';

	public const MASTER_CONSTANT = 'FAIR_TIMETABLE_INTERNAL';

	/**
	 * Canonical bundle registry. Labels/descriptions stay untranslated here so
	 * `is_enabled()` is safe to call before `init`.
	 *
	 * @return array<string,array{label:string,description:string,default:bool,always_on?:bool}>
	 */
	public static function registry() {
		return array(
			'core'                 => array(
				'label'       => 'Core',
				'description' => 'Timetable blocks. Always on.',
				'default'     => true,
				'always_on'   => true,
			),
			'bundled-translations' => array(
				'label'       => 'Bundled translations',
				'description' => 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs. Useful while a locale is below the 90% threshold on translate.wordpress.org or for in-progress strings.',
				'default'     => false,
			),
		);
	}

	/**
	 * Resolve whether a feature bundle is enabled.
	 *
	 * @param string $key Bundle key.
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
	 * Full snapshot for the Settings UI.
	 *
	 * @return array<string,array{label:string,description:string,default:bool,always_on:bool,enabled:bool,forced:bool}>
	 */
	public static function all() {
		$translated = array(
			'core'                 => array(
				'label'       => __( 'Core', 'fair-timetable' ),
				'description' => __( 'Timetable blocks. Always on.', 'fair-timetable' ),
			),
			'bundled-translations' => array(
				'label'       => __( 'Bundled translations', 'fair-timetable' ),
				'description' => __( 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs. Useful while a locale is below the 90% threshold on translate.wordpress.org or for in-progress strings.', 'fair-timetable' ),
			),
		);

		$out = array();
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
	 * Path passed to wp_set_script_translations() for the bundled-translations
	 * opt-in. Returns null when the flag is off.
	 *
	 * @return string|null
	 */
	public static function script_translations_path() {
		return self::is_enabled( 'bundled-translations' )
			? plugin_dir_path( dirname( __DIR__ ) ) . 'build/languages'
			: null;
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
			'FAIR_TIMETABLE_FEATURE_',
			self::MASTER_CONSTANT,
			'fair_timetable_feature_enabled'
		);
	}
}
