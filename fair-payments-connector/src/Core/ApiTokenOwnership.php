<?php
/**
 * API token ownership for Fair Payments Connector
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Core;

defined( 'WPINC' ) || die;

/**
 * Decides whether this plugin runs API tokens and the data sharing API.
 *
 * API tokens moved here from Fair Payments Connector Experimental. Both
 * plugins can be active during the transition, in either update order, so
 * exactly one of them must own token management, the token admin routes and
 * the token-authenticated external routes:
 *
 * - This plugin defines OWNS_CONSTANT when its main file loads. An updated
 *   experimental plugin sees it and yields.
 * - An updated experimental plugin defines HANDOFF_CONSTANT when its main file
 *   loads, announcing that it yields. It keeps its own implementation only as
 *   a fallback for a release of this plugin that predates OWNS_CONSTANT.
 * - An experimental release older than the handoff defines neither constant
 *   and keeps serving API tokens itself, so this plugin stays out of the way
 *   until that release is updated or deactivated.
 *
 * Plugin main files all load before `plugins_loaded`, so the decision does not
 * depend on the order WordPress loads the two plugins in.
 */
class ApiTokenOwnership {

	/**
	 * Defined by this plugin's main file: this release can own API tokens.
	 */
	const OWNS_CONSTANT = 'FAIR_PAYMENTS_CONNECTOR_OWNS_API_TOKENS';

	/**
	 * Defined by the experimental plugin's main file when it hands API tokens over.
	 */
	const HANDOFF_CONSTANT = 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_API_TOKENS_HANDOFF';

	/**
	 * Defined by every release of the experimental plugin while it is active.
	 */
	const EXPERIMENTAL_VERSION_CONSTANT = 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_VERSION';

	/**
	 * Whether this plugin serves API tokens on this request.
	 *
	 * Call on or after `plugins_loaded`.
	 *
	 * @return bool
	 */
	public static function is_owner() {
		return self::resolve(
			defined( self::EXPERIMENTAL_VERSION_CONSTANT ),
			defined( self::HANDOFF_CONSTANT )
		);
	}

	/**
	 * Ownership for a given experimental-plugin state.
	 *
	 * @param bool $experimental_active    Whether any experimental release is active.
	 * @param bool $experimental_hands_off Whether that release hands API tokens over.
	 * @return bool
	 */
	public static function resolve( $experimental_active, $experimental_hands_off ) {
		return ! $experimental_active || $experimental_hands_off;
	}
}
