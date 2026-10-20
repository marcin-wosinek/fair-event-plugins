<?php
/**
 * Seed (or clean up) the Other Sessions block fixtures (#1885).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-other-sessions.php seed
 *   wp eval-file wp-content/mu-plugins/scripts/seed-other-sessions.php cleanup '<E2E_SEED json>'
 *
 * Switches the site to Europe/Madrid (restored on cleanup), then creates a
 * weekly 10-session series (today -14 … +49 days, 19:00–20:30) on a
 * fair_event post with Event Info and Other Sessions. Sessions are changed
 * so the list covers every display and boundary case:
 *   -14  the master (first session), past
 *   -7   moved to yesterday without times: past since midnight
 *   0    today without times: ongoing, listed through today
 *   +7   start time only, at genuine midnight, with its own address
 *   +14  end time only, online
 *   +21  its own times (20:00–21:30)
 *   +28  all day, two days long
 *   +35  moved to today, ending at midnight that started it: already ended
 *   +42  cancelled
 *   +49  as the series (the sixth eligible session, cut by the default 5)
 *
 * Also creates: a page linked to the series with a limit of 2; a page linked
 * directly to the +14 session; a series that starts in 3 days (its first
 * session is listed); a series that has ended; a single event; and a page
 * without an event. Each carries the block.
 *
 * Expected labels are built here in the site timezone so the spec doesn't
 * re-implement the formatting.
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
		WP_CLI::error( 'Usage: seed-other-sessions.php cleanup <E2E_SEED json>' );
	}

	foreach ( $seed['eventDateIds'] as $date_id ) {
		foreach ( EventDates::get_generated_by_master_id( (int) $date_id, true ) as $child ) {
			EventDates::delete_by_id( $child->id );
		}
		EventDates::delete_by_id( (int) $date_id );
	}
	foreach ( $seed['postIds'] as $owner_post_id ) {
		EventDates::delete_by_event_id( (int) $owner_post_id );
		wp_delete_post( (int) $owner_post_id, true );
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

$date_of = static function ( $days ) use ( $today ) {
	return $today->modify( sprintf( '%+d days', $days ) )->format( 'Y-m-d' );
};

$create_post = static function ( $post_type, $title, $content ) {
	$owner_post_id = wp_insert_post(
		array(
			'post_type'    => $post_type,
			'post_status'  => 'publish',
			'post_title'   => $title,
			'post_content' => $content,
		),
		true
	);
	if ( is_wp_error( $owner_post_id ) ) {
		WP_CLI::error( 'Failed to create post: ' . $owner_post_id->get_error_message() );
	}
	return (int) $owner_post_id;
};

/**
 * Create a weekly series on a post and return its sessions by start date.
 *
 * @return array{0: int, 1: array<string, int>} Master ID, session IDs by date.
 */
$create_series = static function ( $owner_post_id, $first_days, $count, $address ) use ( $date_of ) {
	$first     = $date_of( $first_days );
	$master_id = EventDates::save_occurrence( $owner_post_id, $first . ' 19:00:00', $first . ' 20:30:00', false, 'single' );
	EventDates::update_by_id( $master_id, array( 'address' => $address ) );
	$rrule = 'FREQ=WEEKLY;COUNT=' . (int) $count;
	EventDates::save_rrule( $owner_post_id, $rrule );
	RecurrenceService::regenerate_event_occurrences( $owner_post_id, $rrule );
	$master_id = (int) EventDates::get_by_event_id( $owner_post_id )->id;

	$sessions = array();
	foreach ( EventDates::get_all_by_master_id( $master_id ) as $row ) {
		$sessions[ $row->start_date ] = (int) $row->id;
	}

	for ( $week = 0; $week < $count; $week++ ) {
		if ( empty( $sessions[ $date_of( $first_days + 7 * $week ) ] ) ) {
			WP_CLI::error( 'Missing generated session for ' . $date_of( $first_days + 7 * $week ) );
		}
	}

	return array( $master_id, $sessions );
};

$block = static function ( $attributes = '' ) {
	return '<!-- wp:fair-events/other-sessions ' . ( '' === $attributes ? '' : $attributes . ' ' ) . '/-->';
};

// Main series.
$series_post_id                  = $create_post( 'fair_event', 'E2E Other Sessions ' . $suffix, '<!-- wp:fair-events/event-info /-->' . "\n\n" . $block() );
list( $master_id, $sessions_by ) = $create_series( $series_post_id, -14, 10, 'Calle Serie 1, Madrid' );
$session                         = static function ( $days ) use ( $sessions_by, $date_of ) {
	return $sessions_by[ $date_of( $days ) ];
};

$timing = static function ( $start_date, $end_date, $start_time, $end_time, $all_day = 0 ) {
	return array(
		'start_date' => $start_date,
		'end_date'   => $end_date,
		'start_time' => $start_time,
		'end_time'   => $end_time,
		'all_day'    => $all_day,
	);
};

EventDates::update_by_id( $session( -7 ), $timing( $date_of( -1 ), $date_of( -1 ), null, null ) );
EventDates::update_by_id( $session( 0 ), $timing( $date_of( 0 ), $date_of( 0 ), null, null ) );
EventDates::update_by_id( $session( 7 ), array_merge( $timing( $date_of( 7 ), $date_of( 7 ), '00:00:00', null ), array( 'address' => 'Calle Cambio 2, Madrid' ) ) );
EventDates::update_by_id( $session( 14 ), array_merge( $timing( $date_of( 14 ), $date_of( 14 ), null, '21:30:00' ), array( 'attendance_mode' => 'online' ) ) );
EventDates::update_by_id( $session( 21 ), $timing( $date_of( 21 ), $date_of( 21 ), '20:00:00', '21:30:00' ) );
EventDates::update_by_id( $session( 28 ), $timing( $date_of( 28 ), $date_of( 29 ), null, null, 1 ) );
EventDates::update_by_id( $session( 35 ), $timing( $date_of( 0 ), $date_of( 0 ), null, '00:00:00' ) );
EventDates::update_by_id( $session( 42 ), array( 'status' => 'cancelled' ) );

// A page linked to the series, listing at most two sessions.
$limited_page_id = $create_post( 'page', 'E2E Other Sessions Limited ' . $suffix, $block( '{"maxSessions":2}' ) );
EventDates::add_linked_post( $master_id, $limited_page_id );

// A page linked directly to the +14 session.
$session_page_id = $create_post( 'page', 'E2E Other Sessions Linked ' . $suffix, $block() );
EventDates::add_linked_post( $session( 14 ), $session_page_id );

// A series whose first session is still ahead.
$future_post_id               = $create_post( 'fair_event', 'E2E Other Sessions Future ' . $suffix, $block() );
list( $future_master_id, $f ) = $create_series( $future_post_id, 3, 2, 'Calle Futura 4, Madrid' );

// A series that has ended.
$ended_post_id               = $create_post( 'fair_event', 'E2E Other Sessions Ended ' . $suffix, $block() );
list( $ended_master_id, $e ) = $create_series( $ended_post_id, -14, 2, 'Calle Pasada 5, Madrid' );

// A single event, and a page without an event.
$single_post_id   = $create_post( 'fair_event', 'E2E Other Sessions Single ' . $suffix, $block() );
$single_date_id   = EventDates::save_occurrence( $single_post_id, $date_of( 3 ) . ' 10:00:00', $date_of( 3 ) . ' 12:00:00', false, 'single' );
$unlinked_page_id = $create_post( 'page', 'E2E Other Sessions Unlinked ' . $suffix, $block() );

$day = static function ( $days ) use ( $date_of, $timezone ) {
	return wp_date( 'j F Y', ( new DateTimeImmutable( $date_of( $days ), $timezone ) )->getTimestamp(), $timezone );
};

$series_url   = get_permalink( $series_post_id );
$future_url   = get_permalink( $future_post_id );
$session_link = static function ( $url, $days ) use ( $date_of ) {
	return add_query_arg( 'event_date', $date_of( $days ), $url );
};

// Sessions in list order, as the spec expects them.
$expected = array(
	'today'    => array(
		'label' => $day( 0 ),
		'href'  => $session_link( $series_url, 0 ),
	),
	'midnight' => array(
		'label'    => '00:00, ' . $day( 7 ),
		'href'     => $session_link( $series_url, 7 ),
		'location' => 'Calle Cambio 2, Madrid',
	),
	'endOnly'  => array(
		'label'  => 'Ends 21:30, ' . $day( 14 ),
		'href'   => $session_link( $series_url, 14 ),
		'online' => true,
	),
	'override' => array(
		'label'    => '20:00—21:30, ' . $day( 21 ),
		'href'     => $session_link( $series_url, 21 ),
		'location' => 'Calle Serie 1, Madrid',
	),
	'allDay'   => array(
		'label'  => wp_date( 'j', ( new DateTimeImmutable( $date_of( 28 ), $timezone ) )->getTimestamp(), $timezone ) . '–' . $day( 29 ),
		'href'   => $session_link( $series_url, 28 ),
		'allDay' => true,
	),
	'last'     => array(
		'label' => '19:00—20:30, ' . $day( 49 ),
		'href'  => $session_link( $series_url, 49 ),
	),
);

// Two-day all-day labels across a year boundary repeat the year, and across
// a month boundary read "30 October—1 November 2026".
if ( substr( $date_of( 28 ), 0, 4 ) !== substr( $date_of( 29 ), 0, 4 ) ) {
	$expected['allDay']['label'] = $day( 28 ) . '—' . $day( 29 );
} elseif ( substr( $date_of( 28 ), 0, 7 ) !== substr( $date_of( 29 ), 0, 7 ) ) {
	$start_day                   = new DateTimeImmutable( $date_of( 28 ), $timezone );
	$expected['allDay']['label'] = wp_date( 'j F', $start_day->getTimestamp(), $timezone ) . '—' . $day( 29 );
}

echo 'E2E_SEED:' . wp_json_encode(
	array(
		'previousTimezoneString' => $previous_timezone_string,
		'previousGmtOffset'      => $previous_gmt_offset,
		'eventDateIds'           => array( $master_id, $future_master_id, $ended_master_id, (int) $single_date_id ),
		'postIds'                => array( $series_post_id, $limited_page_id, $session_page_id, $future_post_id, $ended_post_id, $single_post_id, $unlinked_page_id ),
		'seriesPostId'           => $series_post_id,
		'seriesUrl'              => $series_url,
		'limitedUrl'             => get_permalink( $limited_page_id ),
		'sessionPageUrl'         => get_permalink( $session_page_id ),
		'futureUrl'              => $future_url,
		'futureFirst'            => array(
			'label' => '19:00—20:30, ' . $day( 3 ),
			'href'  => $session_link( $future_url, 3 ),
		),
		'endedUrl'               => get_permalink( $ended_post_id ),
		'singleUrl'              => get_permalink( $single_post_id ),
		'unlinkedPostId'         => $unlinked_page_id,
		'unlinkedUrl'            => get_permalink( $unlinked_page_id ),
		'dates'                  => array(
			'midnight' => $date_of( 7 ),
			'endOnly'  => $date_of( 14 ),
		),
		'sessions'               => $expected,
	)
) . "\n";
