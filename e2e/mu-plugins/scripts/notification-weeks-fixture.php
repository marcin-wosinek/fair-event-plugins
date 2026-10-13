<?php
/**
 * Adjacent-week fixtures and state restoration for notification API tests.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\EventDates;
use FairEvents\Notifications\DeliveryLog;
use FairEvents\Notifications\WeekSchedule;

require_once __DIR__ . '/../lib/event-factory.php';

$fixture_action  = $args[0] ?? '';
$fixture_key     = 'fair_e2e_notification_weeks_fixture';
$fixture_options = array(
	'timezone_string',
	'start_of_week',
	'fair_events_notification_telegram',
	'fair_events_notification_telegram_next_run',
	'fair_events_notification_bulk_email',
	'fair_events_notification_bulk_email_next_run',
	'fair_events_notification_bulk_email_last_sent_week',
	'fair_events_notification_individual_email',
	'fair_events_notification_individual_email_next_run',
	'fair_events_notification_individual_email_last_sent_week',
	'fair_events_experimental_weekly_telegram_token',
	'fair_e2e_telegram_requests',
	'fair_e2e_captured_mail',
);
$out             = array();
if ( 'site' === $fixture_action ) {
	$out = array(
		'url'     => site_url(),
		'offline' => in_array( realpath( __DIR__ . '/../lib/telegram-http-double.php' ), get_included_files(), true ) && in_array( realpath( __DIR__ . '/../fair-e2e-support.php' ), get_included_files(), true ),
	);
} elseif ( 'seed' === $fixture_action ) {
	$saved = array();
	foreach ( $fixture_options as $option ) {
		$saved[ $option ] = get_option( $option, null );
	}
	update_option(
		$fixture_key,
		array(
			'options' => $saved,
			'events'  => array(),
		),
		false
	);
	update_option( 'timezone_string', 'America/Los_Angeles' );
	update_option( 'start_of_week', 0 );
	$today  = new DateTimeImmutable( 'today', wp_timezone() );
	$monday = $today->modify( '-' . ( (int) $today->format( 'N' ) - 1 ) . ' days' );
	$events = array();
	for ( $offset = -1; $offset <= 20; ++$offset ) {
		$date             = $monday->modify( '+' . $offset . ' days' )->format( 'Y-m-d' );
		$fixture_title    = 'E2E week boundary ' . $date;
		$fixture_event_id = fair_e2e_create_event( $fixture_title, '' );
		wp_set_object_terms( $fixture_event_id, array( (int) $args[1] ), 'category' );
		EventDates::save( $fixture_event_id, $date . ' 00:00:00', $date . ' 01:00:00', false );
		$events[] = array(
			'id'    => $fixture_event_id,
			'date'  => $date,
			'title' => $fixture_title,
		);
		update_option(
			$fixture_key,
			array(
				'options' => $saved,
				'events'  => $events,
			),
			false
		);
	}
	update_option( 'fair_events_experimental_weekly_telegram_token', '123456789:AAEe2eWeeklyNotificationsToken0123456' );
	$out = array(
		'today'   => $today->format( 'Y-m-d' ),
		'weekday' => (int) $today->format( 'N' ),
		'events'  => $events,
	);
} elseif ( 'prior' === $fixture_action ) {
	$week = ( new DateTimeImmutable( 'now', wp_timezone() ) )->format( 'o-\WW' );
	foreach ( array( 'bulk_email', 'individual_email' ) as $channel ) {
		update_option( 'fair_events_notification_' . $channel . '_last_sent_week', $week );
	}
	global $wpdb;
	$saved = get_option( $fixture_key );
	$log   = new DeliveryLog();
	foreach ( array( 'current', 'next' ) as $scope ) {
		$covered = WeekSchedule::target_week( new DateTimeImmutable( 'now', wp_timezone() ), $scope, 0 );
		if ( $log->claim( $covered['start'], 'telegram', '@e2e_week_scope', 1, 1 ) ) {
			$saved['deliveries'][] = (int) $wpdb->insert_id;
			$log->finish(
				$covered['start'],
				'telegram',
				'@e2e_week_scope',
				1,
				array(
					'state'   => 'sent',
					'code'    => '',
					'message' => '',
				)
			);
		}
	}
	update_option( $fixture_key, $saved, false );
	$out = array( 'week' => $week );
} elseif ( 'captured' === $fixture_action ) {
	$out = array(
		'telegram' => get_option( 'fair_e2e_telegram_requests', array() ),
		'mail'     => get_option( 'fair_e2e_captured_mail', array() ),
	);
} elseif ( 'clear' === $fixture_action ) {
	delete_option( 'fair_e2e_telegram_requests' );
	delete_option( 'fair_e2e_captured_mail' );
} elseif ( 'cleanup' === $fixture_action ) {
	global $wpdb;
	$saved = get_option( $fixture_key, array() );
	foreach ( $saved['events'] ?? array() as $event ) {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- isolated test teardown.
		$wpdb->delete( $wpdb->prefix . 'fair_event_dates', array( 'event_id' => $event['id'] ), array( '%d' ) );
		wp_delete_post( $event['id'], true );
	}
	foreach ( $saved['deliveries'] ?? array() as $delivery_id ) {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- remove only claims created by this fixture.
		$wpdb->delete( DeliveryLog::table_name(), array( 'id' => $delivery_id ), array( '%d' ) );
	}
	foreach ( $saved['options'] ?? array() as $option => $value ) {
		if ( null === $value ) {
			delete_option( $option );
		} else {
			update_option( $option, $value );
		}
	}
	foreach ( array( 'telegram', 'bulk_email', 'individual_email' ) as $channel ) {
		$class          = '\\FairEvents\\Notifications\\' . array(
			'telegram'         => 'TelegramDispatcher',
			'bulk_email'       => 'BulkEmailDispatcher',
			'individual_email' => 'IndividualEmailDispatcher',
		)[ $channel ];
		$settings_class = str_replace( 'Dispatcher', 'Settings', $class );
		$class::reschedule( $settings_class::get() );
	}
	delete_option( $fixture_key );
	$out = array( 'cleaned' => true );
} else {
	WP_CLI::error( 'Expected seed <termId>, prior, captured, clear or cleanup.' );
}
echo 'E2E_NOTIFICATION_WEEKS:' . wp_json_encode( (object) $out ) . "\n";
