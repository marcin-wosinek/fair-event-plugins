<?php
/**
 * Delete an E2E-seeded event and everything hanging off it, by id.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-event.php <eventId> <eventDateId>
 *
 * Removes the participants that signed up for the event date (buyers), their
 * option rows, the event-participant rows, the ticket types/prices/options/
 * sale periods/dates, and finally the fair_event post. Deleting by id keeps
 * repeated local runs from accumulating rows and guarantees no later test sees
 * a previous test's data. Captured mail is reset separately by the fixture.
 *
 * Prints a single `E2E_CLEANUP:{json}` line with row counts for debuggability.
 *
 * @package FairEventsE2E
 */

global $wpdb;

$event_id      = isset( $args[0] ) ? (int) $args[0] : 0;
$event_date_id = isset( $args[1] ) ? (int) $args[1] : 0;

if ( ! $event_id || ! $event_date_id ) {
	WP_CLI::error( 'Usage: cleanup-event.php <eventId> <eventDateId>' );
}

$participants_table  = $wpdb->prefix . 'fair_audience_participants';
$event_parts_table   = $wpdb->prefix . 'fair_audience_event_participants';
$part_options_table  = $wpdb->prefix . 'fair_audience_event_participant_options';
$types_table         = $wpdb->prefix . 'fair_events_ticket_types';
$prices_table        = $wpdb->prefix . 'fair_events_ticket_prices';
$options_table       = $wpdb->prefix . 'fair_events_ticket_options';
$option_prices_table = $wpdb->prefix . 'fair_events_ticket_option_prices';
$sale_periods_table  = $wpdb->prefix . 'fair_events_ticket_sale_periods';
$dates_table         = $wpdb->prefix . 'fair_event_dates';
$payments_table      = $wpdb->prefix . 'fair_payment_transactions';

$deleted = array();

// All occurrences belonging to this event (a 'multiple_instances' purchase
// creates one event-participant row per chosen occurrence, not just on the
// master $event_date_id).
// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script, no cache to honour.
$series_event_date_ids = $wpdb->get_col(
	$wpdb->prepare( 'SELECT id FROM %i WHERE event_id = %d', $dates_table, $event_id )
);
if ( ! in_array( $event_date_id, array_map( 'intval', $series_event_date_ids ), true ) ) {
	$series_event_date_ids[] = $event_date_id;
}
$series_placeholders = implode( ', ', array_fill( 0, count( $series_event_date_ids ), '%d' ) );

// Event-participant rows for every occurrence, and the participants they
// reference (the buyers — seeded events create no participants themselves).
// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $series_placeholders is a safe list of %d.
$event_participant_ids = $wpdb->get_col(
	$wpdb->prepare(
		"SELECT id FROM %i WHERE event_date_id IN ({$series_placeholders})",
		array_merge( array( $event_parts_table ), $series_event_date_ids )
	)
);
$participant_ids       = $wpdb->get_col(
	$wpdb->prepare(
		"SELECT participant_id FROM %i WHERE event_date_id IN ({$series_placeholders})",
		array_merge( array( $event_parts_table ), $series_event_date_ids )
	)
);
// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

if ( $event_participant_ids ) {
	$placeholders = implode( ', ', array_fill( 0, count( $event_participant_ids ), '%d' ) );
	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $placeholders is a safe list of %d.
	$deleted['participant_options'] = (int) $wpdb->query(
		$wpdb->prepare(
			"DELETE FROM %i WHERE event_participant_id IN ({$placeholders})",
			array_merge( array( $part_options_table ), $event_participant_ids )
		)
	);
	// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
}

// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $series_placeholders is a safe list of %d.
$deleted['event_participants'] = (int) $wpdb->query(
	$wpdb->prepare(
		"DELETE FROM %i WHERE event_date_id IN ({$series_placeholders})",
		array_merge( array( $event_parts_table ), $series_event_date_ids )
	)
);
// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

if ( $participant_ids ) {
	$participant_ids = array_values( array_unique( array_map( 'intval', $participant_ids ) ) );
	$placeholders    = implode( ', ', array_fill( 0, count( $participant_ids ), '%d' ) );
	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $placeholders is a safe list of %d.
	$deleted['participants'] = (int) $wpdb->query(
		$wpdb->prepare(
			"DELETE FROM %i WHERE id IN ({$placeholders})",
			array_merge( array( $participants_table ), $participant_ids )
		)
	);
	// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
}

// Ticket options + their per-period prices.
$option_ids = $wpdb->get_col(
	$wpdb->prepare( 'SELECT id FROM %i WHERE event_date_id = %d', $options_table, $event_date_id )
);
if ( $option_ids ) {
	$placeholders = implode( ', ', array_fill( 0, count( $option_ids ), '%d' ) );
	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $placeholders is a safe list of %d.
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM %i WHERE ticket_option_id IN ({$placeholders})",
			array_merge( array( $option_prices_table ), $option_ids )
		)
	);
	// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
}
$deleted['ticket_options'] = (int) $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE event_date_id = %d', $options_table, $event_date_id )
);

// Ticket types + their per-period prices.
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
	$wpdb->prepare( 'DELETE FROM %i WHERE event_date_id = %d', $sale_periods_table, $event_date_id )
);

// Get-tickets signup rows (fair-events standalone purchase path).
$deleted['get_tickets_signups'] = (int) $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE event_date_id = %d', $wpdb->prefix . 'fair_events_signups', $event_date_id )
);

// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $series_placeholders is a safe list of %d.
$deleted['transactions'] = (int) $wpdb->query(
	$wpdb->prepare(
		"DELETE FROM %i WHERE event_date_id IN ({$series_placeholders})",
		array_merge( array( $payments_table ), $series_event_date_ids )
	)
);
// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

$deleted['event_dates'] = (int) $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE event_id = %d', $dates_table, $event_id )
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

$deleted['post'] = wp_delete_post( $event_id, true ) ? 1 : 0;

echo 'E2E_CLEANUP:' . wp_json_encode( $deleted ) . "\n";
