<?php
/**
 * Delete everything seed-signup-export-answers.php created, by id (#1568).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-signup-export-answers.php \
 *     <eventId> <eventDateId> <ticketTypeId> <linkedSignupId> <submissionId>
 *
 * Removes the two signup rows (the directly-seeded one and any created by
 * the spec's live browser submission), the seeded submission + its answers,
 * the ticket type/price/sale period, the event date, and the event post.
 *
 * @package FairEventsE2E
 */

use FairForm\Database\QuestionnaireSubmissionRepository;
use FairForm\Database\QuestionnaireAnswerRepository;

global $wpdb;

$event_id         = isset( $args[0] ) ? (int) $args[0] : 0;
$event_date_id    = isset( $args[1] ) ? (int) $args[1] : 0;
$ticket_type_id   = isset( $args[2] ) ? (int) $args[2] : 0;
$linked_signup_id = isset( $args[3] ) ? (int) $args[3] : 0;
$submission_id    = isset( $args[4] ) ? (int) $args[4] : 0;

if ( ! $event_id || ! $event_date_id ) {
	WP_CLI::error( 'Usage: cleanup-signup-export-answers.php <eventId> <eventDateId> <ticketTypeId> <linkedSignupId> <submissionId>' );
}

$deleted = array();

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script, no cache to honour.

// Every signup for this event date, including the live-browser one the spec
// creates and the directly-seeded linked one.
$signups_table      = $wpdb->prefix . 'fair_events_signups';
$deleted['signups'] = $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE event_date_id = %d', $signups_table, $event_date_id )
);

if ( $submission_id ) {
	( new QuestionnaireAnswerRepository() )->delete_by_submission( $submission_id );
	( new QuestionnaireSubmissionRepository() )->delete_by_id( $submission_id );
	$deleted['submission'] = $submission_id;
}

$prices_table       = $wpdb->prefix . 'fair_events_ticket_prices';
$types_table        = $wpdb->prefix . 'fair_events_ticket_types';
$sale_periods_table = $wpdb->prefix . 'fair_events_ticket_sale_periods';
$dates_table        = $wpdb->prefix . 'fair_event_dates';

if ( $ticket_type_id ) {
	$deleted['prices'] = $wpdb->query(
		$wpdb->prepare( 'DELETE FROM %i WHERE ticket_type_id = %d', $prices_table, $ticket_type_id )
	);
	$deleted['types']  = $wpdb->query(
		$wpdb->prepare( 'DELETE FROM %i WHERE id = %d', $types_table, $ticket_type_id )
	);
}

$deleted['sale_periods'] = $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE event_date_id = %d', $sale_periods_table, $event_date_id )
);
$deleted['dates']        = $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE id = %d', $dates_table, $event_date_id )
);

wp_delete_post( $event_id, true );
$deleted['post'] = $event_id;

// phpcs:enable

echo 'E2E_EXPORT_ANSWERS_CLEANUP:' . wp_json_encode( $deleted ) . "\n";
