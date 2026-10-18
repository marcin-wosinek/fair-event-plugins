<?php
/**
 * Move an event date's creation back by a number of days, then report its
 * creation day and today in the site timezone — for the sale-period
 * creation-start E2E spec (#1841).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/event-date-creation-fixture.php <eventDateId> <daysAgo>
 *
 * `created_at` holds database time, so the shift is done in SQL rather than
 * by writing a PHP-formatted datetime.
 *
 * Prints a single `E2E_CREATION:{json}` line with `createdDate` and `today`
 * (Y-m-d), plus `createdLabel`: the creation day in the site's date format,
 * as the event-prices block prints it.
 *
 * @package FairEventsE2E
 */

use FairEvents\Models\EventDates;

global $wpdb;

$event_date_id = isset( $args[0] ) ? (int) $args[0] : 0;
$days_ago      = isset( $args[1] ) ? (int) $args[1] : 0;

if ( ! $event_date_id ) {
	WP_CLI::error( 'Usage: event-date-creation-fixture.php <eventDateId> <daysAgo>' );
}

// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- test fixture backdating a row.
$wpdb->query(
	$wpdb->prepare(
		'UPDATE %i SET created_at = created_at - INTERVAL %d DAY WHERE id = %d',
		$wpdb->prefix . 'fair_event_dates',
		$days_ago,
		$event_date_id
	)
);

$timestamp = EventDates::get_creation_timestamp( $event_date_id );

if ( ! $timestamp ) {
	WP_CLI::error( "No creation time for event date {$event_date_id}." );
}

$created_date = wp_date( 'Y-m-d', $timestamp );
$created_day  = date_create( $created_date . ' 00:00:00', wp_timezone() );

echo 'E2E_CREATION:' . wp_json_encode(
	array(
		'createdDate'  => $created_date,
		'createdLabel' => wp_date( get_option( 'date_format' ), $created_day->getTimestamp() ),
		'today'        => current_time( 'Y-m-d' ),
	)
) . "\n";
