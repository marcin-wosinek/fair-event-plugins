<?php
/**
 * Backdate an event-participant relationship for statistics API coverage.
 *
 * Usage: wp eval-file .../set-event-participant-created-at.php <event-date-id> <participant-id> <ISO-date-time>
 *
 * The date-time is site-local; it is stored in UTC, as the database clock
 * records relationship creation times.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// Test fixture intentionally updates the relationship timestamp directly.
// phpcs:disable WordPress.DB.DirectDatabaseQuery
global $wpdb;

$event_date_id  = isset( $args[0] ) ? absint( $args[0] ) : 0;
$participant_id = isset( $args[1] ) ? absint( $args[1] ) : 0;
$created_at     = isset( $args[2] ) ? str_replace( 'T', ' ', sanitize_text_field( $args[2] ) ) : '';

$updated = $wpdb->update(
	$wpdb->prefix . 'fair_audience_event_participants',
	array( 'created_at' => get_gmt_from_date( $created_at ) ),
	array(
		'event_date_id'  => $event_date_id,
		'participant_id' => $participant_id,
	),
	array( '%s' ),
	array( '%d', '%d' )
);

echo 'E2E_EVENT_STATISTICS:' . wp_json_encode( array( 'updated' => $updated ) );
