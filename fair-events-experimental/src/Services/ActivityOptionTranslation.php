<?php
/**
 * Activity Option Translation Service
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

defined( 'WPINC' ) || die;

/**
 * Bridges TicketOption (activity) name/short_name values to Polylang's
 * string translation API.
 *
 * `register()` is called from the admin save/read path so every
 * non-empty value gets a stable Polylang string; `translate_name()` /
 * `translate_short_name()` are called from the public render paths to
 * resolve that string in the current frontend language. Every Polylang
 * call is guarded with `function_exists()` so activating/deactivating
 * Polylang — or it simply not being installed — never causes a fatal
 * error; the original stored value is returned unchanged in that case.
 */
class ActivityOptionTranslation {

	/**
	 * Polylang string group these strings are registered under.
	 *
	 * @var string
	 */
	const GROUP = 'Fair Events';

	/**
	 * Register an option's translatable values with Polylang.
	 *
	 * Uses a stable string name per option/field so editing a value
	 * updates the same registered string instead of creating a new one.
	 * Empty values are not registered.
	 *
	 * @param object $option Activity option (needs id, name, short_name).
	 * @return void
	 */
	public static function register( $option ) {
		if ( ! function_exists( 'pll_register_string' ) || ! $option || empty( $option->id ) ) {
			return;
		}

		if ( self::has_value( $option->name ?? null ) ) {
			pll_register_string( self::string_name( $option->id, 'name' ), $option->name, self::GROUP );
		}

		if ( self::has_value( $option->short_name ?? null ) ) {
			pll_register_string( self::string_name( $option->id, 'short_name' ), $option->short_name, self::GROUP );
		}
	}

	/**
	 * Resolve an option's name in the current Polylang language.
	 *
	 * @param object $option Activity option (needs name).
	 * @return string Translated value, or the original value when
	 *                Polylang is unavailable, inactive, or has no
	 *                translation for it.
	 */
	public static function translate_name( $option ) {
		return self::translate_field( $option, 'name', '' );
	}

	/**
	 * Resolve an option's short name in the current Polylang language.
	 *
	 * @param object $option Activity option (needs short_name).
	 * @return string|null Translated value, or the original value when
	 *                      Polylang is unavailable, inactive, or has no
	 *                      translation for it. Null when no short name
	 *                      was ever set.
	 */
	public static function translate_short_name( $option ) {
		return self::translate_field( $option, 'short_name', null );
	}

	/**
	 * Shared implementation behind translate_name()/translate_short_name().
	 *
	 * @param object      $option   Activity option.
	 * @param string      $field    'name' or 'short_name'.
	 * @param string|null $fallback Value to fall back to when $option is
	 *                              missing or has no value for $field.
	 * @return string|null
	 */
	private static function translate_field( $option, $field, $fallback ) {
		if ( ! $option ) {
			return $fallback;
		}

		$value = $option->$field ?? $fallback;

		if ( ! self::has_value( $value ) || ! function_exists( 'pll__' ) ) {
			return $value;
		}

		return pll__( $value );
	}

	/**
	 * Whether a stored field value counts as set. Deliberately not
	 * `empty()` — a `"0"` option name/short_name is a real value, not a
	 * blank one, and `empty( '0' )` is true in PHP.
	 *
	 * @param mixed $value Field value.
	 * @return bool
	 */
	private static function has_value( $value ) {
		return null !== $value && '' !== $value;
	}

	/**
	 * Build the stable Polylang string name for an option field.
	 *
	 * @param int    $id    Option ID.
	 * @param string $field 'name' or 'short_name'.
	 * @return string
	 */
	private static function string_name( $id, $field ) {
		return "fair_events_ticket_option_{$id}_{$field}";
	}
}
