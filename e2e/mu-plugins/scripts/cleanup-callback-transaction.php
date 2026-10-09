<?php
/**
 * Delete a transaction seeded by seed-callback-transaction.php.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-callback-transaction.php <transactionId>
 *
 * Only removes rows carrying the fixture's `tr_e2e_callback_` payment id, so a
 * wrong id can never delete a transaction another spec created.
 *
 * Prints a single `E2E_CALLBACK_TX_CLEANUP:{json}` line with the row count.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$transaction_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $transaction_id ) {
	WP_CLI::error( 'Usage: cleanup-callback-transaction.php <transactionId>' );
}

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script, no cache to honour.
$deleted = (int) $wpdb->query(
	$wpdb->prepare(
		'DELETE FROM %i WHERE id = %d AND mollie_payment_id LIKE %s',
		$wpdb->prefix . 'fair_payment_transactions',
		$transaction_id,
		$wpdb->esc_like( 'tr_e2e_callback_' ) . '%'
	)
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

echo 'E2E_CALLBACK_TX_CLEANUP:' . wp_json_encode( array( 'transactions' => $deleted ) ) . "\n";
