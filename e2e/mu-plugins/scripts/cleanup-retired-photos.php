<?php
/**
 * Delete what seed-retired-photos.php created and restore default features.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-retired-photos.php <attachmentId> <participantId>...
 *
 * Prints a single `E2E_CLEANUP:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$attachment_id = isset( $args[0] ) ? (int) $args[0] : 0;

foreach ( array_map( 'intval', array_slice( $args, 1 ) ) as $participant_id ) {
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery
	$wpdb->delete( $wpdb->prefix . 'fair_audience_participants', array( 'id' => $participant_id ) );
}
wp_delete_attachment( $attachment_id, true );
delete_option( 'fair_audience_experimental_features' );

echo 'E2E_CLEANUP:' . wp_json_encode( array( 'attachmentId' => $attachment_id ) ) . "\n";
