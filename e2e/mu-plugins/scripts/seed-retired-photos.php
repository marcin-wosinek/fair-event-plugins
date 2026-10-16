<?php
/**
 * Recreate photo authors, tags and bulk upload preferences as an older
 * installation had them.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-retired-photos.php
 *
 * Creates the legacy photo authors/tags table with an author and a tagged
 * participant on a new attachment, the admin's bulk upload author/tag
 * preferences, the stored `photos` feature choice, and rewinds the
 * fair-audience schema version so the next WordPress load runs the photo
 * cleanup again.
 *
 * Prints a single `E2E_SEED:{json}` line with the created ids.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

// phpcs:disable WordPress.DB.DirectDatabaseQuery
$charset = $wpdb->get_charset_collate();
$wpdb->query( "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}fair_audience_photo_participants (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, attachment_id BIGINT UNSIGNED NOT NULL, participant_id BIGINT UNSIGNED NOT NULL, role ENUM('author', 'tagged') NOT NULL DEFAULT 'author', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id)) {$charset}" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- fixed test-only DDL.

$attachment_id = wp_insert_attachment(
	array(
		'post_title'     => 'E2E retired photo',
		'post_mime_type' => 'image/jpeg',
		'post_status'    => 'inherit',
	)
);

$participant_ids = array();
foreach ( array( 'Author', 'Tagged' ) as $surname ) {
	$participant = new \FairAudience\Models\Participant(
		array(
			'name'          => 'Photo',
			'surname'       => $surname,
			'email'         => 'e2e-photo-' . strtolower( $surname ) . '-' . wp_generate_password( 8, false ) . '@example.com',
			'email_profile' => 'minimal',
			'status'        => 'confirmed',
		)
	);
	$participant->save();
	$participant_ids[] = (int) $participant->id;
}

$wpdb->insert(
	$wpdb->prefix . 'fair_audience_photo_participants',
	array(
		'attachment_id'  => $attachment_id,
		'participant_id' => $participant_ids[0],
		'role'           => 'author',
	)
);
$wpdb->insert(
	$wpdb->prefix . 'fair_audience_photo_participants',
	array(
		'attachment_id'  => $attachment_id,
		'participant_id' => $participant_ids[1],
		'role'           => 'tagged',
	)
);
// phpcs:enable

$admin = get_user_by( 'login', 'admin' );
update_user_meta( $admin->ID, 'fair_audience_bulk_upload_author', $participant_ids[0] );
update_user_meta( $admin->ID, 'fair_audience_bulk_upload_tags', array( $participant_ids[1] ) );

// Store the choice as the old code did: the current sanitizer no longer
// knows the `photos` key and would drop it.
remove_all_filters( 'sanitize_option_fair_audience_experimental_features' );
update_option(
	'fair_audience_experimental_features',
	array(
		'photos' => true,
		'polls'  => true,
	)
);
update_option( 'fair_audience_db_version', '1.45.0' );

echo 'E2E_SEED:' . wp_json_encode(
	array(
		'attachmentId'   => (int) $attachment_id,
		'participantIds' => $participant_ids,
	)
) . "\n";
