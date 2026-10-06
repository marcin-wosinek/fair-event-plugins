<?php
/**
 * API token fallback ownership for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Core;

defined( 'WPINC' ) || die;

/**
 * Decides whether this plugin still serves API tokens.
 *
 * API tokens moved to Fair Payments Connector. This plugin keeps its
 * implementation only for a Fair Payments Connector release that predates the
 * move, so updating the two plugins in either order never leaves a site
 * without the data sharing API, or with two plugins serving it.
 *
 * Fair Payments Connector defines OWNS_CONSTANT in its main file once it
 * includes API tokens. Plugin main files all load before `plugins_loaded`, so
 * the decision does not depend on the order WordPress loads the two plugins in.
 */
class ApiTokenFallback {

	/**
	 * Defined by Fair Payments Connector's main file when it includes API tokens.
	 */
	const OWNS_CONSTANT = 'FAIR_PAYMENTS_CONNECTOR_OWNS_API_TOKENS';

	/**
	 * Defined by this plugin's main file: this release hands API tokens over.
	 */
	const HANDOFF_CONSTANT = 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_API_TOKENS_HANDOFF';

	/**
	 * Whether this plugin serves API tokens on this request.
	 *
	 * Call on or after `plugins_loaded`.
	 *
	 * @return bool
	 */
	public static function is_owner() {
		return self::resolve( defined( self::OWNS_CONSTANT ) );
	}

	/**
	 * Ownership for a given Fair Payments Connector state.
	 *
	 * @param bool $connector_owns Whether the active Fair Payments Connector includes API tokens.
	 * @return bool
	 */
	public static function resolve( $connector_owns ) {
		return ! $connector_owns;
	}
}
