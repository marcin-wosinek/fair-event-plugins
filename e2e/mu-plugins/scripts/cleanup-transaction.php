<?php
/**
 * Delete a single fair_payment_transactions row by id.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-transaction.php <transactionId>
 *
 * Companion to seed-pending-signup.php: the participant + event_participant
 * rows it creates are removed by cleanup-event.php (matched by event_date_id),
 * but that script doesn't know about fair-payments-connector's table, so the
 * transaction row needs its own teardown.
 *
 * Prints a single `E2E_TX_CLEANUP:{json}` line with the deleted row count.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$transaction_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $transaction_id ) {
	WP_CLI::error( 'Usage: cleanup-transaction.php <transactionId>' );
}

$transactions_table = $wpdb->prefix . 'fair_payment_transactions';

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script, no cache to honour.
$deleted = (int) $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE id = %d', $transactions_table, $transaction_id )
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

echo 'E2E_TX_CLEANUP:' . wp_json_encode( array( 'transactions' => $deleted ) ) . "\n";
