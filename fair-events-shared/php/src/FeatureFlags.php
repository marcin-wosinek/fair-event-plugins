<?php
/**
 * Shared feature-flag mechanics.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared;

defined( 'WPINC' ) || die;

/**
 * Resolves, reports forced state for, and sanitizes a plugin's feature flags.
 *
 * Each plugin keeps its own registry, option name, constants, and filter; this
 * class only holds the resolution rules they share. An instance holds no
 * cached results, so every call reads the current constants, option, and
 * filters.
 *
 * Resolution for is_enabled():
 *
 *   1. Unknown key → false. `always_on` entry → true (constants and the
 *      filter are bypassed).
 *   2. Per-feature constant `<prefix><UPPER_KEY>` (hyphens → underscores)
 *      → its Boolean value; the filter is bypassed.
 *   3. Master constant strictly `true` → true; otherwise the stored option
 *      value for the key, then the registry default.
 *   4. The filter receives the step-3 result and the key, and its Boolean
 *      result wins — so a filter can override the master switch even though
 *      is_forced() still reports the key as forced.
 *
 * Registry entries are `key => array( 'default' => bool, 'always_on' => bool )`;
 * other entry fields are ignored here.
 */
class FeatureFlags {

	/**
	 * Feature registry.
	 *
	 * @var array<string,array>
	 */
	private $registry;

	/**
	 * Option name holding stored `[ key => bool ]` values.
	 *
	 * @var string
	 */
	private $option;

	/**
	 * Prefix of the per-feature constants, e.g. `FAIR_EVENTS_FEATURE_`.
	 *
	 * @var string
	 */
	private $constant_prefix;

	/**
	 * Master switch constant name.
	 *
	 * @var string
	 */
	private $master_constant;

	/**
	 * Filter applied to the master/stored/default result.
	 *
	 * @var string
	 */
	private $filter;

	/**
	 * Constructor.
	 *
	 * @param array<string,array> $registry        Feature registry.
	 * @param string              $option          Option name for stored values.
	 * @param string              $constant_prefix Per-feature constant prefix.
	 * @param string              $master_constant Master switch constant name.
	 * @param string              $filter          Filter name.
	 */
	public function __construct( array $registry, $option, $constant_prefix, $master_constant, $filter ) {
		$this->registry        = $registry;
		$this->option          = (string) $option;
		$this->constant_prefix = (string) $constant_prefix;
		$this->master_constant = (string) $master_constant;
		$this->filter          = (string) $filter;
	}

	/**
	 * Whether a feature is enabled. Unknown keys resolve to false.
	 *
	 * @param string $key Feature key.
	 * @return bool
	 */
	public function is_enabled( $key ) {
		if ( ! isset( $this->registry[ $key ] ) ) {
			return false;
		}

		if ( ! empty( $this->registry[ $key ]['always_on'] ) ) {
			return true;
		}

		$constant = $this->constant_name( $key );
		if ( defined( $constant ) ) {
			return (bool) constant( $constant );
		}

		if ( $this->master_enabled() ) {
			$enabled = true;
		} else {
			$stored  = get_option( $this->option, array() );
			$enabled = is_array( $stored ) && array_key_exists( $key, $stored )
				? (bool) $stored[ $key ]
				: (bool) $this->registry[ $key ]['default'];
		}

		return (bool) apply_filters( $this->filter, $enabled, $key );
	}

	/**
	 * Whether a feature's value is fixed outside the Settings UI: always-on,
	 * a per-feature constant, or the master switch. Unknown keys are not
	 * forced.
	 *
	 * @param string $key Feature key.
	 * @return bool
	 */
	public function is_forced( $key ) {
		if ( ! isset( $this->registry[ $key ] ) ) {
			return false;
		}

		if ( ! empty( $this->registry[ $key ]['always_on'] ) ) {
			return true;
		}

		if ( defined( $this->constant_name( $key ) ) ) {
			return true;
		}

		return $this->master_enabled();
	}

	/**
	 * Sanitize a submitted option value to the known, unforced keys.
	 *
	 * A non-array submission yields an empty array. Forced keys keep their
	 * existing stored value (when present) regardless of the submission;
	 * known keys omitted from the submission keep their existing value.
	 * Defaults are never written.
	 *
	 * @param mixed $value Raw submitted value.
	 * @return array<string,bool>
	 */
	public function sanitize_option( $value ) {
		if ( ! is_array( $value ) ) {
			return array();
		}

		$existing = get_option( $this->option, array() );
		if ( ! is_array( $existing ) ) {
			$existing = array();
		}

		$out = array();
		foreach ( $this->registry as $key => $entry ) {
			if ( ! empty( $entry['always_on'] ) ) {
				continue;
			}

			if ( $this->is_forced( $key ) ) {
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
	 * Per-feature constant name, e.g. `bundled-translations` →
	 * `<prefix>BUNDLED_TRANSLATIONS`.
	 *
	 * @param string $key Feature key.
	 * @return string
	 */
	public function constant_name( $key ) {
		return $this->constant_prefix . strtoupper( str_replace( '-', '_', $key ) );
	}

	/**
	 * Whether the master switch is defined and strictly true.
	 *
	 * @return bool
	 */
	private function master_enabled() {
		return defined( $this->master_constant ) && true === constant( $this->master_constant );
	}
}
