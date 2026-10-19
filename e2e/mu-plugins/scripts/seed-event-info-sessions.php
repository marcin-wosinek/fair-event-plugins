<?php
/**
 * Seed (or clean up) the Event Info session-selection fixtures (#1884).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-event-info-sessions.php seed
 *   wp eval-file wp-content/mu-plugins/scripts/seed-event-info-sessions.php cleanup '<E2E_SEED json>'
 *
 * Switches the site to Europe/Madrid (restored on cleanup), then creates:
 *   - a weekly 5-session series (today -14, -7, 0, +7, +14 days at 19:00–20:30
 *     site-local) on a fair_event post with the Event Info block. Session +7
 *     overrides its time (20:00–21:30) and address; session +14 is online;
 *     today's session has no end time.
 *   - a single event (+3 days, 10:00–12:00) with the Event Info block.
 *   - a page linked directly to the -7 session (a junction row on the
 *     generated occurrence, as older data can hold).
 *
 * Expected date strings are built here in the site timezone and locale so the
 * spec doesn't re-implement the formatting.
 *
 * Prints a single `E2E_SEED:{json}` (or `E2E_CLEANUP:{json}`) line.
 *
 * @package FairEventsE2E
 */

use FairEvents\Models\EventDates;
use FairEvents\Services\RecurrenceService;

defined( 'ABSPATH' ) || exit;

$script_mode = isset( $args[0] ) ? (string) $args[0] : 'seed';

if ( 'cleanup' === $script_mode ) {
	$seed = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : null;
	if ( ! is_array( $seed ) ) {
		WP_CLI::error( 'Usage: seed-event-info-sessions.php cleanup <E2E_SEED json>' );
	}

	foreach ( array( (int) $seed['seriesEventDateId'], (int) $seed['singleEventDateId'] ) as $date_id ) {
		foreach ( EventDates::get_generated_by_master_id( $date_id, true ) as $child ) {
			EventDates::delete_by_id( $child->id );
		}
		EventDates::delete_by_id( $date_id );
	}
	foreach ( array( 'seriesPostId', 'singlePostId', 'linkedPageId' ) as $key ) {
		EventDates::delete_by_event_id( (int) $seed[ $key ] );
		wp_delete_post( (int) $seed[ $key ], true );
	}
	update_option( 'timezone_string', (string) $seed['previousTimezoneString'] );
	update_option( 'gmt_offset', $seed['previousGmtOffset'] );

	echo 'E2E_CLEANUP:' . wp_json_encode( array( 'ok' => true ) ) . "\n";
	return;
}

$previous_timezone_string = (string) get_option( 'timezone_string' );
$previous_gmt_offset      = get_option( 'gmt_offset' );
update_option( 'timezone_string', 'Europe/Madrid' );

$timezone = wp_timezone();
$today    = new DateTimeImmutable( 'today', $timezone );
$suffix   = gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 );

/**
 * A site-local 'Y-m-d H:i:s' at a day offset from today.
 *
 * @param DateTimeImmutable $today  Today at midnight, site-local.
 * @param int               $days   Day offset.
 * @param string            $time   'H:i'.
 * @return string
 */
$local = static function ( DateTimeImmutable $today, $days, $time ) {
	return $today->modify( sprintf( '%+d days', $days ) )->format( 'Y-m-d' ) . ' ' . $time . ':00';
};

$create_post = static function ( $post_type, $title, $content ) {
	$post_id = wp_insert_post(
		array(
			'post_type'    => $post_type,
			'post_status'  => 'publish',
			'post_title'   => $title,
			'post_content' => $content,
		),
		true
	);
	if ( is_wp_error( $post_id ) ) {
		WP_CLI::error( 'Failed to create post: ' . $post_id->get_error_message() );
	}
	return (int) $post_id;
};

$block = '<!-- wp:fair-events/event-info /-->';

// Recurring series.
$series_post_id = $create_post( 'fair_event', 'E2E Session Series ' . $suffix, $block );
$master_id      = EventDates::save_occurrence( $series_post_id, $local( $today, -14, '19:00' ), $local( $today, -14, '20:30' ), false, 'single' );
EventDates::update_by_id( $master_id, array( 'address' => 'Calle Serie 1, Madrid' ) );
EventDates::save_rrule( $series_post_id, 'FREQ=WEEKLY;COUNT=5' );
RecurrenceService::regenerate_event_occurrences( $series_post_id, 'FREQ=WEEKLY;COUNT=5' );
$master_id = (int) EventDates::get_by_event_id( $series_post_id )->id;

$sessions = array();
foreach ( EventDates::get_all_by_master_id( $master_id ) as $row ) {
	$sessions[ $row->start_date ] = (int) $row->id;
}

$date_of = static function ( $days ) use ( $today ) {
	return $today->modify( sprintf( '%+d days', $days ) )->format( 'Y-m-d' );
};

foreach ( array( -14, -7, 0, 7, 14 ) as $days ) {
	if ( empty( $sessions[ $date_of( $days ) ] ) ) {
		WP_CLI::error( 'Missing generated session for ' . $date_of( $days ) );
	}
}

EventDates::update_by_id(
	$sessions[ $date_of( 7 ) ],
	array(
		'start_date' => $date_of( 7 ),
		'end_date'   => $date_of( 7 ),
		'start_time' => '20:00:00',
		'end_time'   => '21:30:00',
		'address'    => 'Calle Cambio 2, Madrid',
	)
);
EventDates::update_by_id( $sessions[ $date_of( 14 ) ], array( 'attendance_mode' => 'online' ) );
// Today's session has no end time.
EventDates::update_by_id( $sessions[ $date_of( 0 ) ], array( 'end_time' => null ) );

// Single event.
$single_post_id = $create_post( 'fair_event', 'E2E Session Single ' . $suffix, $block );
$single_date_id = EventDates::save_occurrence( $single_post_id, $local( $today, 3, '10:00' ), $local( $today, 3, '12:00' ), false, 'single' );
EventDates::update_by_id( $single_date_id, array( 'address' => 'Calle Sola 3, Madrid' ) );

// Page linked directly to the -7 session.
$linked_page_id = $create_post( 'page', 'E2E Session Linked ' . $suffix, $block );
EventDates::add_linked_post( $sessions[ $date_of( -7 ) ], $linked_page_id );

$label = static function ( $date, $start, $end ) use ( $timezone ) {
	$day = new DateTimeImmutable( $date, $timezone );
	return $start . '—' . $end . ', ' . wp_date( 'j F Y', $day->getTimestamp(), $timezone );
};

echo 'E2E_SEED:' . wp_json_encode(
	array(
		'previousTimezoneString' => $previous_timezone_string,
		'previousGmtOffset'      => $previous_gmt_offset,
		'seriesPostId'           => $series_post_id,
		'seriesEventDateId'      => $master_id,
		'seriesUrl'              => get_permalink( $series_post_id ),
		'singlePostId'           => $single_post_id,
		'singleEventDateId'      => (int) $single_date_id,
		'singleUrl'              => get_permalink( $single_post_id ),
		'singleDate'             => $date_of( 3 ),
		'linkedPageId'           => $linked_page_id,
		'linkedUrl'              => get_permalink( $linked_page_id ),
		'sessions'               => array(
			'first'    => array(
				'id'    => $master_id,
				'date'  => $date_of( -14 ),
				'label' => $label( $date_of( -14 ), '19:00', '20:30' ),
			),
			'past'     => array(
				'id'    => $sessions[ $date_of( -7 ) ],
				'date'  => $date_of( -7 ),
				'label' => $label( $date_of( -7 ), '19:00', '20:30' ),
			),
			'today'    => array(
				'id'   => $sessions[ $date_of( 0 ) ],
				'date' => $date_of( 0 ),
			),
			'override' => array(
				'id'    => $sessions[ $date_of( 7 ) ],
				'date'  => $date_of( 7 ),
				'label' => $label( $date_of( 7 ), '20:00', '21:30' ),
			),
			'online'   => array(
				'id'   => $sessions[ $date_of( 14 ) ],
				'date' => $date_of( 14 ),
			),
		),
	)
) . "\n";
