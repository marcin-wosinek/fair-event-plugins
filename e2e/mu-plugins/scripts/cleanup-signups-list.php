<?php
/**
 * Tear down E2E-seeded data for the signups-list test (issue #888).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-signups-list.php \
 *     <eventId> <eventDateId> <groupId> <memberParticipantId> <otherParticipantId>
 *
 * Prints a single `E2E_SIGNUPS_CLEANUP:{json}` line with row counts.
 *
 * @package FairEventsE2E
 */

global $wpdb;

$event_id              = isset( $args[0] ) ? (int) $args[0] : 0;
$event_date_id         = isset( $args[1] ) ? (int) $args[1] : 0;
$group_id              = isset( $args[2] ) ? (int) $args[2] : 0;
$member_participant_id = isset( $args[3] ) ? (int) $args[3] : 0;
$other_participant_id  = isset( $args[4] ) ? (int) $args[4] : 0;

if ( ! $event_id || ! $event_date_id || ! $group_id || ! $member_participant_id || ! $other_participant_id ) {
	WP_CLI::error( 'Usage: cleanup-signups-list.php <eventId> <eventDateId> <groupId> <memberParticipantId> <otherParticipantId>' );
}

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script.

$deleted = array();

$perm_rules_table   = $wpdb->prefix . 'fair_events_group_permission_rules';
$event_parts_table  = $wpdb->prefix . 'fair_audience_event_participants';
$participants_table = $wpdb->prefix . 'fair_audience_participants';
$group_parts_table  = $wpdb->prefix . 'fair_audience_group_participants';
$groups_table       = $wpdb->prefix . 'fair_audience_groups';
$dates_table        = $wpdb->prefix . 'fair_event_dates';

$deleted['permission_rules']   = (int) $wpdb->delete( $perm_rules_table, array( 'event_date_id' => $event_date_id ), array( '%d' ) );
$deleted['event_participants'] = (int) $wpdb->delete( $event_parts_table, array( 'event_date_id' => $event_date_id ), array( '%d' ) );
$deleted['group_participants'] = (int) $wpdb->delete( $group_parts_table, array( 'group_id' => $group_id ), array( '%d' ) );
$deleted['groups']             = (int) $wpdb->delete( $groups_table, array( 'id' => $group_id ), array( '%d' ) );

$participant_ids = array( $member_participant_id, $other_participant_id );
$placeholders    = implode( ', ', array_fill( 0, 2, '%d' ) );
// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- safe %d placeholders.
$deleted['participants'] = (int) $wpdb->query(
	$wpdb->prepare(
		"DELETE FROM %i WHERE id IN ({$placeholders})",
		array_merge( array( $participants_table ), $participant_ids )
	)
);
// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

$deleted['event_dates'] = (int) $wpdb->delete( $dates_table, array( 'event_id' => $event_id ), array( '%d' ) );
$deleted['post']        = wp_delete_post( $event_id, true ) ? 1 : 0;

// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

echo 'E2E_SIGNUPS_CLEANUP:' . wp_json_encode( $deleted ) . "\n";
