<?php
/**
 * Delete what seed-retired-collaborators.php created and restore default
 * features.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-retired-collaborators.php <participantId>
 *
 * The seeded event itself is removed by the `seedEvent` fixture.
 *
 * Prints a single `E2E_CLEANUP:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$participant_id = isset( $args[0] ) ? (int) $args[0] : 0;

// phpcs:disable WordPress.DB.DirectDatabaseQuery
$wpdb->delete( $wpdb->prefix . 'fair_audience_event_participants', array( 'participant_id' => $participant_id ) );
$wpdb->delete( $wpdb->prefix . 'fair_audience_participants', array( 'id' => $participant_id ) );
// phpcs:enable
delete_option( 'fair_audience_experimental_features' );

echo 'E2E_CLEANUP:' . wp_json_encode( array( 'participantId' => $participant_id ) ) . "\n";
