<?php
/**
 * Report the get-tickets signup rows (and their transactions) for an event date.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/get-tickets-state.php <event_date_id>
 *
 * Prints a single `E2E_GT_STATE:{json}` line with one entry per
 * fair_events_signups row: name, email, quantity, amount, status, and — when a
 * transaction is attached — its status and mode from fair_payment_transactions.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$event_date_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $event_date_id ) {
	WP_CLI::error( 'Usage: get-tickets-state.php <event_date_id>' );
}

$signups_table      = $wpdb->prefix . 'fair_events_signups';
$transactions_table = $wpdb->prefix . 'fair_payment_transactions';

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off state dump for the spec, no cache to honour.
$rows = $wpdb->get_results(
	$wpdb->prepare( 'SELECT * FROM %i WHERE event_date_id = %d ORDER BY id ASC', $signups_table, $event_date_id )
);

$signups = array();
foreach ( $rows as $row ) {
	$entry = array(
		'id'             => (int) $row->id,
		'name'           => (string) $row->name,
		'email'          => (string) $row->email,
		'quantity'       => (int) $row->quantity,
		'amount'         => (float) $row->amount,
		'status'         => (string) $row->status,
		'transaction_id' => $row->transaction_id ? (int) $row->transaction_id : null,
	);

	if ( $row->transaction_id ) {
		$tx = $wpdb->get_row(
			$wpdb->prepare( 'SELECT status, testmode, mollie_payment_id FROM %i WHERE id = %d', $transactions_table, (int) $row->transaction_id )
		);
		if ( $tx ) {
			$entry['transaction_status']   = (string) $tx->status;
			$entry['transaction_testmode'] = (bool) $tx->testmode;
			$entry['mollie_payment_id']    = (string) $tx->mollie_payment_id;
		}
	}

	$signups[] = $entry;
}
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

echo 'E2E_GT_STATE:' . wp_json_encode( array( 'signups' => $signups ) ) . "\n";
