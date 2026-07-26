<?php
/**
 * Feature flag registry for Fair Form.
 *
 * @package FairForm
 */

namespace FairForm\Core;

defined( 'WPINC' ) || die;

/**
 * Feature flag registry.
 *
 * Resolution order for is_enabled() (first match wins):
 *
 *   1. Per-feature constant `FAIR_FORM_FEATURE_<UPPER>` (true/false).
 *   2. Master switch `FAIR_FORM_INTERNAL` (true → every bundle on).
 *   3. `fair_form_feature_enabled` filter (programmatic / tests).
 *   4. Stored option `fair_form_features` ([ key => bool ]) from Settings UI.
 *   5. Hardcoded default in the registry below.
 */
class Features {

	public const OPTION = 'fair_form_features';

	public const MASTER_CONSTANT = 'FAIR_FORM_INTERNAL';

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

		return (bool) apply_filters( 'fair_form_feature_enabled', $enabled, $key );
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
	 * Sanitize an option payload to the known key set, dropping forced keys
	 * (so a UI write cannot override a wp-config decision).
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
	 * opt-in. Returns null when the flag is off.
	 *
	 * @return string|null
	 */
	public static function script_translations_path() {
		return self::is_enabled( 'bundled-translations' )
			? FAIR_FORM_DIR . 'build/languages'
			: null;
	}

	/**
	 * Per-feature constant name.
	 *
	 * @param string $key Bundle key.
	 * @return string
	 */
	private static function feature_constant_name( $key ) {
		return 'FAIR_FORM_FEATURE_' . strtoupper( str_replace( '-', '_', $key ) );
	}
}
