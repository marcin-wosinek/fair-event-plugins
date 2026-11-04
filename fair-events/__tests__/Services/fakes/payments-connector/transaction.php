<?php
/**
 * An active Fair Payments Connector: its transaction model, reading the
 * transactions a test seeds in $GLOBALS['_fair_test_transactions'].
 *
 * @package FairEvents
 */

namespace FairPaymentsConnector\Models;

// phpcs:disable Generic.Classes.DuplicateClassName -- stand-in with Connector's signature, loaded per test process.

/**
 * Stand-in transaction model.
 */
class Transaction {

	/**
	 * Seeded transaction by ID.
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return object|null
	 */
	public static function get_by_id( $transaction_id ) {
		$transactions = $GLOBALS['_fair_test_transactions'] ?? array();
		return isset( $transactions[ (int) $transaction_id ] ) ? (object) $transactions[ (int) $transaction_id ] : null;
	}
}
