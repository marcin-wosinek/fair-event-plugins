<?php
/**
 * Feature flag registry for Fair Finance.
 *
 * @package FairFinance
 */

namespace FairFinance\Core;

use FairEventsShared\FeatureFlags;

defined( 'WPINC' ) || die;

/**
 * Feature flag registry.
 *
 * Resolution for is_enabled(), implemented by
 * {@see \FairEventsShared\FeatureFlags}:
 *
 *   1. Per-feature constant `FAIR_FINANCE_FEATURE_<UPPER>` (true/false) wins outright;
 *      the filter is not applied.
 *   2. Master switch `FAIR_FINANCE_INTERNAL` (strictly true) → enabled; otherwise
 *      the stored option `fair_finance_features` ([ key => bool ]) from the
 *      Settings UI, then the hardcoded default in the registry below.
 *   3. `fair_finance_feature_enabled` filter receives the step-2 result and has the
 *      last word — it can override the master switch, although
 *      is_forced() still reports the key as forced.
 */
class Features {

	public const OPTION = 'fair_finance_features';

	public const MASTER_CONSTANT = 'FAIR_FINANCE_INTERNAL';

	/**
	 * Canonical bundle registry.
	 *
	 * @return array<string,array{label:string,description:string,default:bool,always_on?:bool}>
	 */
	public static function registry() {
		return array(
			'bundled-translations' => array(
				'label'       => 'Bundled translations',
				'description' => 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs.',
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
			? FAIR_FINANCE_DIR . 'build/languages'
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
			'FAIR_FINANCE_FEATURE_',
			self::MASTER_CONSTANT,
			'fair_finance_feature_enabled'
		);
	}
}
