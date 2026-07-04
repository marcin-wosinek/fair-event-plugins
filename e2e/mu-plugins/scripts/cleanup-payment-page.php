<?php
/**
 * Delete an E2E-seeded simple-payment page and the transactions it created.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-payment-page.php <pageId>
 *
 * Transactions are matched by their post_id column (set by PaymentEndpoint from
 * the block's post context), so repeated local runs don't accumulate paid rows
 * that would skew the fee dashboard.
 *
 * Prints a single `E2E_PAYMENT_CLEANUP:{json}` line with row counts.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$page_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $page_id ) {
	WP_CLI::error( 'Usage: cleanup-payment-page.php <pageId>' );
}

$transactions_table = $wpdb->prefix . 'fair_payment_transactions';
$line_items_table   = $wpdb->prefix . 'fair_payment_line_items';

$deleted = array();

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script, no cache to honour.
$transaction_ids = $wpdb->get_col(
	$wpdb->prepare( 'SELECT id FROM %i WHERE post_id = %d', $transactions_table, $page_id )
);

if ( $transaction_ids ) {
	$placeholders = implode( ', ', array_fill( 0, count( $transaction_ids ), '%d' ) );
	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $placeholders is a safe list of %d.
	$deleted['line_items'] = (int) $wpdb->query(
		$wpdb->prepare(
			"DELETE FROM %i WHERE transaction_id IN ({$placeholders})",
			array_merge( array( $line_items_table ), $transaction_ids )
		)
	);
	// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
}

$deleted['transactions'] = (int) $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE post_id = %d', $transactions_table, $page_id )
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

$deleted['page'] = wp_delete_post( $page_id, true ) ? 1 : 0;

echo 'E2E_PAYMENT_CLEANUP:' . wp_json_encode( $deleted ) . "\n";
