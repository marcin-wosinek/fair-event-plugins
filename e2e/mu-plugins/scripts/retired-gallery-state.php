<?php
/**
 * Report what remains of the retired event gallery after the upgrade ran.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/retired-gallery-state.php <attachmentId>
 *
 * Prints a single `E2E_STATE:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$attachment_id = isset( $args[0] ) ? (int) $args[0] : 0;

$tables = array();
foreach ( array( 'fair_events_event_photos', 'fair_events_photo_likes', 'fair_audience_gallery_access_keys' ) as $suffix ) {
	$tables[ $suffix ] = (bool) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->prefix . $suffix ) );
}

echo 'E2E_STATE:' . wp_json_encode(
	array(
		'tables'            => $tables,
		'attachmentExists'  => 'attachment' === get_post_type( $attachment_id ),
		'photoAuthorRows'   => (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE attachment_id = %d',
				$wpdb->prefix . 'fair_audience_photo_participants',
				$attachment_id
			)
		),
		'eventsDbVersion'   => get_option( 'fair_events_db_version' ),
		'audienceDbVersion' => get_option( 'fair_audience_db_version' ),
		'eventsFeatures'    => get_option( 'fair_events_experimental_features' ),
		'audienceFeatures'  => get_option( 'fair_audience_experimental_features' ),
	)
) . "\n";
