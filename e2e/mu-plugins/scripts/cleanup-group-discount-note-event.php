<?php
/**
 * Delete everything seed-group-discount-note-event.php created, by id.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-group-discount-note-event.php <eventId> <eventDateId> <participantId> [groupId] [ruleId]
 *
 * Unlike cleanup-event.php, the participant here was never linked via a real
 * signup (event_participants row) — it's identified purely via
 * ?participant_token=, so it must be deleted explicitly by id.
 *
 * @package FairEventsE2E
 */

$event_id       = isset( $args[0] ) ? (int) $args[0] : 0;
$event_date_id  = isset( $args[1] ) ? (int) $args[1] : 0;
$participant_id = isset( $args[2] ) ? (int) $args[2] : 0;
$group_id       = isset( $args[3] ) ? (int) $args[3] : 0;
$rule_id        = isset( $args[4] ) ? (int) $args[4] : 0;

if ( ! $event_id || ! $event_date_id || ! $participant_id ) {
	WP_CLI::error( 'Usage: cleanup-group-discount-note-event.php <eventId> <eventDateId> <participantId> [groupId] [ruleId]' );
}

global $wpdb;

$deleted = array();

if ( $rule_id ) {
	$deleted['rule'] = \FairEventsExperimental\Models\GroupPricingRule::delete( $rule_id ) ? 1 : 0;
}

if ( $group_id ) {
	$deleted['group'] = ( new \FairAudienceExperimental\Models\Group( array( 'id' => $group_id ) ) )->delete() ? 1 : 0;
}

$deleted['participant'] = ( new \FairAudience\Models\Participant( array( 'id' => $participant_id ) ) )->delete() ? 1 : 0;

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script, no cache to honour.
$types_table  = $wpdb->prefix . 'fair_events_ticket_types';
$prices_table = $wpdb->prefix . 'fair_events_ticket_prices';

$type_ids = $wpdb->get_col(
	$wpdb->prepare( 'SELECT id FROM %i WHERE event_date_id = %d', $types_table, $event_date_id )
);
if ( $type_ids ) {
	$placeholders = implode( ', ', array_fill( 0, count( $type_ids ), '%d' ) );
	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $placeholders is a safe list of %d.
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM %i WHERE ticket_type_id IN ({$placeholders})",
			array_merge( array( $prices_table ), $type_ids )
		)
	);
	// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
}
$deleted['ticket_types'] = (int) $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE event_date_id = %d', $types_table, $event_date_id )
);

$deleted['sale_periods'] = (int) $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE event_date_id = %d', $wpdb->prefix . 'fair_events_ticket_sale_periods', $event_date_id )
);

$deleted['event_dates'] = (int) $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE id = %d', $wpdb->prefix . 'fair_event_dates', $event_date_id )
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

$deleted['post'] = wp_delete_post( $event_id, true ) ? 1 : 0;

echo 'E2E_CLEANUP:' . wp_json_encode( $deleted ) . "\n";
