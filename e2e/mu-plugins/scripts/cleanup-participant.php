<?php
/**
 * Delete a single fair_audience_participants row by id.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-participant.php <participantId>
 *
 * Companion to seed-known-participant.php: those participants never sign up
 * for anything (or, for the "recognised email" one, may or may not depending
 * on how far the spec got before failing), so cleanup-event.php's
 * event_participants-driven cleanup can't be relied on to catch them.
 * Deleting by id is a no-op (0 rows) if the row is already gone.
 *
 * Prints a single `E2E_PARTICIPANT_CLEANUP:{json}` line with the deleted row count.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$participant_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $participant_id ) {
	WP_CLI::error( 'Usage: cleanup-participant.php <participantId>' );
}

$participants_table = $wpdb->prefix . 'fair_audience_participants';

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script, no cache to honour.
$deleted = (int) $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE id = %d', $participants_table, $participant_id )
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

echo 'E2E_PARTICIPANT_CLEANUP:' . wp_json_encode( array( 'participants' => $deleted ) ) . "\n";
