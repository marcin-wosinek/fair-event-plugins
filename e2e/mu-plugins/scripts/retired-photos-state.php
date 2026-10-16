<?php
/**
 * Report what remains of photo authors, tags and bulk upload preferences
 * after the upgrade ran.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/retired-photos-state.php <attachmentId> <participantId>...
 *
 * Prints a single `E2E_STATE:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$attachment_id   = isset( $args[0] ) ? (int) $args[0] : 0;
$participant_ids = array_map( 'intval', array_slice( $args, 1 ) );

$remaining_participants = 0;
foreach ( $participant_ids as $participant_id ) {
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery
	$remaining_participants += (int) $wpdb->get_var(
		$wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE id = %d', $wpdb->prefix . 'fair_audience_participants', $participant_id )
	);
}

echo 'E2E_STATE:' . wp_json_encode(
	array(
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		'photoTableExists'  => (bool) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->prefix . 'fair_audience_photo_participants' ) ),
		'attachmentExists'  => 'attachment' === get_post_type( $attachment_id ),
		'participants'      => $remaining_participants,
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		'bulkUploadMeta'    => (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE meta_key IN (%s, %s)',
				$wpdb->usermeta,
				'fair_audience_bulk_upload_author',
				'fair_audience_bulk_upload_tags'
			)
		),
		'audienceDbVersion' => get_option( 'fair_audience_db_version' ),
		'audienceFeatures'  => get_option( 'fair_audience_experimental_features' ),
	)
) . "\n";
