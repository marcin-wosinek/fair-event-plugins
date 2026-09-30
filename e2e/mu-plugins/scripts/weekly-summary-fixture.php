<?php
/**
 * Fixture for the weekly Telegram summary E2E spec (#1735).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/weekly-summary-fixture.php source
 *   wp eval-file wp-content/mu-plugins/scripts/weekly-summary-fixture.php event <termId>
 *   wp eval-file wp-content/mu-plugins/scripts/weekly-summary-fixture.php cleanup <termId> <sourceId> [eventId]
 *
 * `source` creates a category and an enabled event source listing it.
 * `event` publishes an event in that category, dated inside the week the next
 * scheduled send covers under the saved weekly notification settings. Its
 * title carries Telegram markup characters, so the spec can check they are
 * delivered verbatim. `cleanup` removes all of it.
 *
 * Prints a single `E2E_WEEKLY:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Database\EventSourceRepository;
use FairEvents\Models\EventDates;
use FairEventsExperimental\Settings\WeeklyNotificationSettings;
use FairEventsExperimental\WeeklyNotifications\Dispatcher;
use FairEventsExperimental\WeeklyNotifications\WeekSchedule;

require_once __DIR__ . '/../lib/event-factory.php';

$fixture_step = isset( $args[0] ) ? (string) $args[0] : '';
$out          = array();

if ( 'source' === $fixture_step ) {
	$suffix   = gmdate( 'YmdHis' ) . '-' . wp_rand( 1000, 9999 );
	$category = wp_insert_term( 'E2E weekly ' . $suffix, 'category' );
	if ( is_wp_error( $category ) ) {
		WP_CLI::error( 'Failed to create category: ' . $category->get_error_message() );
	}
	$name      = 'E2E weekly source ' . $suffix;
	$source_id = ( new EventSourceRepository() )->create(
		$name,
		'e2e-weekly-' . $suffix,
		array(
			array(
				'source_type' => 'categories',
				'config'      => array( 'category_ids' => array( (int) $category['term_id'] ) ),
			),
		)
	);
	if ( ! $source_id ) {
		WP_CLI::error( 'Failed to create event source.' );
	}
	$out = array(
		'termId'     => (int) $category['term_id'],
		'sourceId'   => (int) $source_id,
		'sourceName' => $name,
	);
} elseif ( 'event' === $fixture_step ) {
	$settings    = WeeklyNotificationSettings::get();
	$due         = WeekSchedule::next_due( Dispatcher::now(), $settings['day_of_week'], $settings['time_of_day'] );
	$week        = WeekSchedule::target_week( $due, $settings['week_scope'], Dispatcher::start_of_week() );
	$event_title = 'E2E *Weekly* _Jam_ [x](y) `z` & 🎉 ' . wp_rand( 1000, 9999 );
	$event_id    = fair_e2e_create_event( $event_title, '<!-- wp:paragraph --><p>Weekly summary fixture.</p><!-- /wp:paragraph -->' );
	wp_set_object_terms( $event_id, array( (int) ( $args[1] ?? 0 ) ), 'category' );
	$start = gmdate( 'Y-m-d', strtotime( $week['start'] . ' +3 days' ) ) . ' 18:00:00';
	// EventDates::save() links the date to the post, as the event editor does.
	if ( ! EventDates::save( $event_id, $start, gmdate( 'Y-m-d H:i:s', strtotime( $start . ' +2 hours' ) ), false ) ) {
		WP_CLI::error( 'Failed to create event date.' );
	}
	$out = array(
		'eventId'    => $event_id,
		'eventTitle' => $event_title,
		'eventUrl'   => get_permalink( $event_id ),
	);
} elseif ( 'cleanup' === $fixture_step ) {
	global $wpdb;
	$term_id   = (int) ( $args[1] ?? 0 );
	$source_id = (int) ( $args[2] ?? 0 );
	$event_id  = (int) ( $args[3] ?? 0 );
	if ( $event_id ) {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script.
		$wpdb->delete( $wpdb->prefix . 'fair_event_dates', array( 'event_id' => $event_id ), array( '%d' ) );
		wp_delete_post( $event_id, true );
	}
	if ( $source_id ) {
		( new EventSourceRepository() )->delete( $source_id );
	}
	if ( $term_id ) {
		wp_delete_term( $term_id, 'category' );
	}
	$out = array( 'cleaned' => true );
} else {
	WP_CLI::error( 'Usage: weekly-summary-fixture.php source | event <termId> | cleanup <termId> <sourceId> [eventId]' );
}

echo 'E2E_WEEKLY:' . wp_json_encode( $out ) . "\n";
