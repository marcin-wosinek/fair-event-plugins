<?php
/**
 * Report a fair-payments-connector transaction row for the E2E specs.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/transaction-state.php <transaction_id>
 *
 * Prints a single `E2E_TX_STATE:{json}` line with the row's status, mode,
 * amount, currency, mollie_payment_id, and post_id.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$transaction_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $transaction_id ) {
	WP_CLI::error( 'Usage: transaction-state.php <transaction_id>' );
}

$transactions_table = $wpdb->prefix . 'fair_payment_transactions';

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off state dump for the spec, no cache to honour.
$tx = $wpdb->get_row(
	$wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', $transactions_table, $transaction_id )
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

if ( ! $tx ) {
	echo 'E2E_TX_STATE:' . wp_json_encode( array( 'found' => false ) ) . "\n";
	return;
}

echo 'E2E_TX_STATE:' . wp_json_encode(
	array(
		'found'             => true,
		'id'                => (int) $tx->id,
		'status'            => (string) $tx->status,
		'testmode'          => (bool) $tx->testmode,
		'amount'            => (float) $tx->amount,
		'currency'          => (string) $tx->currency,
		'mollie_payment_id' => (string) $tx->mollie_payment_id,
		'post_id'           => $tx->post_id ? (int) $tx->post_id : null,
	)
) . "\n";
