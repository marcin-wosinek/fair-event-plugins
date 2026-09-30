<?php
/**
 * Payment notification ownership for Fair Payments Connector
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Core;

defined( 'WPINC' ) || die;

/**
 * Decides whether this plugin runs payment notifications.
 *
 * Payment notifications moved here from Fair Payments Connector Experimental.
 * Both plugins can be active during the transition, in either update order, so
 * exactly one of them must own the notification runtime, REST routes, settings
 * and admin page:
 *
 * - This plugin defines OWNS_CONSTANT when its main file loads. An updated
 *   experimental plugin sees it and yields.
 * - An updated experimental plugin defines HANDOFF_CONSTANT when its main file
 *   loads, announcing that it yields.
 * - An experimental release older than the handoff defines neither constant
 *   and keeps running notifications itself, so this plugin stays out of the
 *   way until that release is updated or deactivated.
 *
 * Plugin main files all load before `plugins_loaded`, so the decision does not
 * depend on the order WordPress loads the two plugins in.
 */
class NotificationOwnership {

	/**
	 * Defined by this plugin's main file: this release can own notifications.
	 */
	const OWNS_CONSTANT = 'FAIR_PAYMENTS_CONNECTOR_OWNS_NOTIFICATIONS';

	/**
	 * Defined by the experimental plugin's main file when it hands notifications over.
	 */
	const HANDOFF_CONSTANT = 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_NOTIFICATIONS_HANDOFF';

	/**
	 * Defined by every release of the experimental plugin while it is active.
	 */
	const EXPERIMENTAL_VERSION_CONSTANT = 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_VERSION';

	/**
	 * Whether this plugin runs payment notifications on this request.
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
	 * @param bool $experimental_active   Whether any experimental release is active.
	 * @param bool $experimental_hands_off Whether that release hands notifications over.
	 * @return bool
	 */
	public static function resolve( $experimental_active, $experimental_hands_off ) {
		return ! $experimental_active || $experimental_hands_off;
	}
}
