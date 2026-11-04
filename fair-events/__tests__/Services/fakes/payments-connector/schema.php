<?php
/**
 * An active Fair Payments Connector: its schema helper.
 *
 * @package FairEvents
 */

namespace FairPaymentsConnector\Database;

// phpcs:disable Generic.Classes.DuplicateClassName -- stand-in with Connector's signature, loaded per test process.

/**
 * Stand-in schema.
 */
class Schema {

	/**
	 * Transactions table.
	 *
	 * @return string
	 */
	public static function get_payments_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_payment_transactions';
	}
}
