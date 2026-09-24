<?php
/**
 * Recreate the retired event gallery's data as an older installation had it.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-retired-gallery.php
 *
 * Creates the legacy gallery tables with a photo link, a like and an access
 * key, an attachment authored by a participant, the old `galleries` feature
 * choices, and rewinds both schema versions so the next WordPress load runs
 * the gallery cleanup again.
 *
 * Prints a single `E2E_SEED:{json}` line with the attachment and participant ids.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

// phpcs:disable WordPress.DB.DirectDatabaseQuery
$charset = $wpdb->get_charset_collate();
$wpdb->query( "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}fair_events_event_photos (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, event_id BIGINT UNSIGNED NOT NULL, event_date_id BIGINT UNSIGNED DEFAULT NULL, attachment_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY (id)) {$charset}" );
$wpdb->query( "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}fair_events_photo_likes (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, attachment_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED DEFAULT NULL, participant_id BIGINT UNSIGNED DEFAULT NULL, PRIMARY KEY (id)) {$charset}" );
$wpdb->query( "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}fair_audience_gallery_access_keys (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, event_id BIGINT UNSIGNED NOT NULL, event_date_id BIGINT UNSIGNED NOT NULL, participant_id BIGINT UNSIGNED NOT NULL, access_key CHAR(64) NOT NULL, token CHAR(32) NOT NULL, PRIMARY KEY (id)) {$charset}" );

$attachment_id = wp_insert_attachment(
	array(
		'post_title'     => 'E2E retired gallery photo',
		'post_mime_type' => 'image/jpeg',
		'post_status'    => 'inherit',
	)
);

$participant = new \FairAudience\Models\Participant(
	array(
		'name'          => 'Gallery',
		'surname'       => 'Author',
		'email'         => 'e2e-gallery-author-' . wp_generate_password( 8, false ) . '@example.com',
		'email_profile' => 'minimal',
		'status'        => 'confirmed',
	)
);
$participant->save();

$wpdb->insert(
	$wpdb->prefix . 'fair_events_event_photos',
	array(
		'event_id'      => 1,
		'event_date_id' => 1,
		'attachment_id' => $attachment_id,
	)
);
$wpdb->insert(
	$wpdb->prefix . 'fair_events_photo_likes',
	array(
		'attachment_id'  => $attachment_id,
		'participant_id' => $participant->id,
	)
);
$wpdb->insert(
	$wpdb->prefix . 'fair_audience_gallery_access_keys',
	array(
		'event_id'       => 1,
		'event_date_id'  => 1,
		'participant_id' => $participant->id,
		'access_key'     => hash( 'sha256', 'e2e-retired-token' ),
		'token'          => 'e2eretiredtoken00000000000000000',
	)
);
$wpdb->insert(
	$wpdb->prefix . 'fair_audience_photo_participants',
	array(
		'attachment_id'  => $attachment_id,
		'participant_id' => $participant->id,
		'role'           => 'author',
	)
);
// phpcs:enable

// Store the choices as the old code did: the current sanitizers no longer
// know the `galleries` key and would drop it.
remove_all_filters( 'sanitize_option_fair_events_experimental_features' );
remove_all_filters( 'sanitize_option_fair_audience_experimental_features' );
update_option( 'fair_events_experimental_features', array( 'galleries' => true ) );
update_option( 'fair_audience_experimental_features', array( 'galleries' => true ) );
update_option( 'fair_events_db_version', '3.35.0' );
update_option( 'fair_audience_db_version', '1.43.0' );

echo 'E2E_SEED:' . wp_json_encode(
	array(
		'attachmentId'  => (int) $attachment_id,
		'participantId' => (int) $participant->id,
	)
) . "\n";
