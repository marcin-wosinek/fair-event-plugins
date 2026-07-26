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
	 * Bundled translations path. This companion is never distributed on
	 * WordPress.org, so it always loads the .mo/.json files it ships instead
	 * of waiting on a language pack that will never exist.
	 *
	 * @return string
	 */
	public static function script_translations_path() {
		return FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_DIR . 'build/languages';
	}
}
