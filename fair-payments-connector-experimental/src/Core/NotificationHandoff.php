<?php
/**
 * Payment notification handoff for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Core;

defined( 'WPINC' ) || die;

/**
 * Decides whether this plugin hands payment notifications to Fair Payments
 * Connector.
 *
 * Payment notifications moved into Fair Payments Connector. A release of it
 * that owns them defines MAIN_OWNS_CONSTANT when its main file loads; this
 * plugin then skips its own notification runtime, REST routes, settings and
 * admin page so nothing runs twice. Next to an older Fair Payments Connector
 * this plugin keeps running notifications as before.
 */
class NotificationHandoff {

	/**
	 * Defined by a Fair Payments Connector release that owns notifications.
	 */
	const MAIN_OWNS_CONSTANT = 'FAIR_PAYMENTS_CONNECTOR_OWNS_NOTIFICATIONS';

	/**
	 * Whether Fair Payments Connector runs notifications on this request.
	 *
	 * Call on or after `plugins_loaded`.
	 *
	 * @return bool
	 */
	public static function yields() {
		return defined( self::MAIN_OWNS_CONSTANT );
	}
}
