<?php
/**
 * Removal of a retired fair-audience-experimental feature choice
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

defined( 'WPINC' ) || die;

/**
 * Removes one stored bundle choice from the fair-audience-experimental
 * feature option, keeping every other choice.
 *
 * A no-op when the choice is already gone, so it can be repeated after a
 * partial failure and works whether or not the companion plugin is active.
 */
class RetiredFeatureChoice {

	/**
	 * Option holding the fair-audience-experimental feature choices.
	 */
	const FEATURES_OPTION = 'fair_audience_experimental_features';

	/**
	 * Remove the stored choice for a retired bundle.
	 *
	 * An older companion's sanitizer copies known keys over from the stored
	 * value, which would put the choice straight back, so it is detached for
	 * this one write.
	 *
	 * @param string $key Retired bundle key.
	 * @return bool True when the option no longer holds the key.
	 */
	public static function remove( $key ) {
		global $wp_filter;

		$features = get_option( self::FEATURES_OPTION );
		if ( ! is_array( $features ) || ! array_key_exists( $key, $features ) ) {
			return true;
		}
		unset( $features[ $key ] );

		$hook      = 'sanitize_option_' . self::FEATURES_OPTION;
		$sanitizer = $wp_filter[ $hook ] ?? null;
		unset( $wp_filter[ $hook ] );

		update_option( self::FEATURES_OPTION, $features );

		if ( null !== $sanitizer ) {
			$wp_filter[ $hook ] = $sanitizer; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the hook detached above.
		}

		$stored = get_option( self::FEATURES_OPTION );
		return ! is_array( $stored ) || ! array_key_exists( $key, $stored );
	}
}
