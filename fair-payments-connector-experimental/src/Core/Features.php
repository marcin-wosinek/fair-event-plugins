<?php
/**
 * Feature flags for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Core;

defined( 'WPINC' ) || die;

/**
 * Reads feature flags stored in the plugin option.
 */
class Features {
	const OPTION = 'fair_payments_connector_experimental_features';

	/**
	 * Whether a named feature flag is enabled.
	 *
	 * @param string $feature Feature name.
	 * @return bool
	 */
	public static function is_enabled( $feature ) {
		$flags = get_option( self::OPTION, array() );
		return ! empty( $flags[ $feature ] );
	}

	/**
	 * Return the bundled translations path when the flag is on, null otherwise.
	 *
	 * @return string|null
	 */
	public static function script_translations_path() {
		return self::is_enabled( 'bundled-translations' )
			? FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_DIR . 'build/languages'
			: null;
	}
}
