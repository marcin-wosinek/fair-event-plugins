<?php
/**
 * Feature flag registry for Fair Payment.
 *
 * Mirrors the resolution order used by Fair Events so the maintainer can flip
 * bundles with a single constant in wp-config, while the Settings UI handles
 * per-feature toggles for everyone else.
 *
 * @package FairPayment
 */

namespace FairPayment\Core;

defined( 'WPINC' ) || die;

/**
 * Feature flag registry.
 *
 * Resolution order for is_enabled() (first match wins):
 *
 *   1. Per-feature constant `FAIR_PAYMENT_FEATURE_<UPPER>` (true/false).
 *   2. Master switch `FAIR_PAYMENT_INTERNAL` (true → every bundle on).
 *   3. `fair_payment_feature_enabled` filter (programmatic / tests).
 *   4. Stored option `fair_payment_features` ([ key => bool ]) from Settings UI.
 *   5. Hardcoded default in the registry below.
 */
class Features {

	public const OPTION = 'fair_payment_features';

	public const MASTER_CONSTANT = 'FAIR_PAYMENT_INTERNAL';

	/**
	 * Canonical bundle registry. Labels/descriptions stay untranslated here so
	 * `is_enabled()` is safe to call before `init`. {@see self::all()} applies
	 * translation when the Settings UI consumes the registry.
	 *
	 * @return array<string,array{label:string,description:string,default:bool,always_on?:bool}>
	 */
	public static function registry() {
		return array(
			'core'                 => array(
				'label'       => 'Core',
				'description' => 'Transactions, settings, payment blocks. Always on.',
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
	 * Resolve whether a feature bundle is enabled. Unknown keys resolve to
	 * false (fail-closed).
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

		$constant = self::feature_constant_name( $key );
		if ( defined( $constant ) ) {
			return (bool) constant( $constant );
		}

		if ( defined( self::MASTER_CONSTANT ) && true === constant( self::MASTER_CONSTANT ) ) {
			$enabled = true;
		} else {
			$stored  = get_option( self::OPTION, array() );
			$enabled = is_array( $stored ) && array_key_exists( $key, $stored )
				? (bool) $stored[ $key ]
				: (bool) $registry[ $key ]['default'];
		}

		return (bool) apply_filters( 'fair_payment_feature_enabled', $enabled, $key );
	}

	/**
	 * Whether the resolved value is forced by a constant — used by the
	 * Settings UI to render the toggle disabled.
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
		$translated = array(
			'core'                 => array(
				'label'       => __( 'Core', 'fair-payment' ),
				'description' => __( 'Transactions, settings, payment blocks. Always on.', 'fair-payment' ),
			),
			'bundled-translations' => array(
				'label'       => __( 'Bundled translations', 'fair-payment' ),
				'description' => __( 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs. Useful while a locale is below the 90% threshold on translate.wordpress.org or for in-progress strings.', 'fair-payment' ),
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
	 * Sanitize an option payload to the known key set, dropping forced keys.
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

		$out = array();
		foreach ( self::registry() as $key => $entry ) {
			if ( ! empty( $entry['always_on'] ) ) {
				continue;
			}

			if ( self::is_forced( $key ) ) {
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
	 * Path passed to wp_set_script_translations() for the bundled-translations
	 * opt-in. Returns null when the flag is off so core resolves JSON from the
	 * WP.org language-pack location.
	 *
	 * @return string|null
	 */
	public static function script_translations_path() {
		return self::is_enabled( 'bundled-translations' )
			? FAIR_PAYMENT_PLUGIN_DIR . 'build/languages'
			: null;
	}

	/**
	 * Per-feature constant name (e.g. `bundled-translations` → `FAIR_PAYMENT_FEATURE_BUNDLED_TRANSLATIONS`).
	 *
	 * @param string $key Bundle key.
	 * @return string
	 */
	private static function feature_constant_name( $key ) {
		return 'FAIR_PAYMENT_FEATURE_' . strtoupper( str_replace( '-', '_', $key ) );
	}
}
