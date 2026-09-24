<?php
/**
 * Delete what seed-retired-gallery.php created and restore default features.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-retired-gallery.php <attachmentId> <participantId>
 *
 * Prints a single `E2E_CLEANUP:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$attachment_id  = isset( $args[0] ) ? (int) $args[0] : 0;
$participant_id = isset( $args[1] ) ? (int) $args[1] : 0;

// phpcs:ignore WordPress.DB.DirectDatabaseQuery
$wpdb->delete( $wpdb->prefix . 'fair_audience_photo_participants', array( 'attachment_id' => $attachment_id ) );
// phpcs:ignore WordPress.DB.DirectDatabaseQuery
$wpdb->delete( $wpdb->prefix . 'fair_audience_participants', array( 'id' => $participant_id ) );
wp_delete_attachment( $attachment_id, true );
delete_option( 'fair_events_experimental_features' );
delete_option( 'fair_audience_experimental_features' );

echo 'E2E_CLEANUP:' . wp_json_encode( array( 'attachmentId' => $attachment_id ) ) . "\n";
