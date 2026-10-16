<?php
/**
 * Report fair-events-experimental Meta engagement outbox rows for an event
 * post, plus the Graph API requests the double has captured.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/meta-engagement-state.php <post_id>
 *
 * Prints a single `E2E_META_ENGAGEMENT:{json}` line: `rows` (one entry per
 * outbox row for the post, oldest first — event_name, state, event_date_id,
 * transaction_id) and `requests` (every decoded body captured by
 * lib/meta-http-double.php across the whole run, oldest first).
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$event_post_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $event_post_id ) {
	WP_CLI::error( 'Usage: meta-engagement-state.php <post_id>' );
}

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off state dump for the spec, no cache to honour.
$rows = $wpdb->get_results(
	$wpdb->prepare(
		'SELECT event_name, state, event_date_id, transaction_id FROM %i WHERE event_post_id = %d ORDER BY id ASC',
		$wpdb->prefix . 'fair_events_meta_outbox',
		$event_post_id
	),
	ARRAY_A
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

echo 'E2E_META_ENGAGEMENT:' . wp_json_encode(
	array(
		'rows'     => $rows ? $rows : array(),
		'requests' => get_option( 'fair_e2e_meta_requests', array() ),
	)
) . "\n";
