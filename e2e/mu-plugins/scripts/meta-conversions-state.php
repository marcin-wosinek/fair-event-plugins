<?php
/**
 * Report fair-events-experimental Meta Conversions outbox rows for a
 * transaction, plus the Graph API requests the double has captured.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/meta-conversions-state.php <transaction_id>
 *
 * Prints a single `E2E_META_STATE:{json}` line: `rows` (one entry per outbox
 * row for the transaction — event_name, state, payment_mode, attempt_count)
 * and `requests` (every decoded body captured by lib/meta-http-double.php
 * across the whole run, oldest first — a spec filters by event_name/
 * custom_data.order_id to find the one it cares about).
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$transaction_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $transaction_id ) {
	WP_CLI::error( 'Usage: meta-conversions-state.php <transaction_id>' );
}

$table = $wpdb->prefix . 'fair_events_meta_outbox';

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off state dump for the spec, no cache to honour.
$rows = $wpdb->get_results(
	$wpdb->prepare(
		'SELECT event_name, state, result_category, payment_mode, attempt_count FROM %i WHERE transaction_id = %d ORDER BY event_name ASC',
		$table,
		$transaction_id
	),
	ARRAY_A
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

echo 'E2E_META_STATE:' . wp_json_encode(
	array(
		'rows'     => $rows ? $rows : array(),
		'requests' => get_option( 'fair_e2e_meta_requests', array() ),
	)
) . "\n";
