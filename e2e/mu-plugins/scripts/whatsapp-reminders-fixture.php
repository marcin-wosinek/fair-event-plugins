<?php
/**
 * Fixture for the WhatsApp sharing reminder specs (#2136).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/whatsapp-reminders-fixture.php feed <label>
 *   wp eval-file …/whatsapp-reminders-fixture.php event <termId> <isoWeek>
 *   wp eval-file …/whatsapp-reminders-fixture.php rename <sourceId> <newSlug>
 *   wp eval-file …/whatsapp-reminders-fixture.php run <isoWeek> <sourceId>
 *   wp eval-file …/whatsapp-reminders-fixture.php next <sourceId>
 *   wp eval-file …/whatsapp-reminders-fixture.php cleanup <json>
 *
 * `feed` creates a category, a published page and an enabled event feed
 * listing the category with that page, and prints the feed's weekly-summary
 * link. `event` publishes an event in the category on the Wednesday of an
 * ISO week. `rename` changes a feed's slug, which changes its summary link.
 * `run` runs the scheduled reminder of a feed for a week, as WP-Cron would.
 * `next` prints the queued run. `cleanup` removes what the other steps
 * created (`{termIds, pageIds, sourceIds, eventIds}`), the feeds' reminders
 * with their runs, and the scheduled reminder events.
 *
 * Prints a single `E2E_REMINDERS:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Database\EventSourceRepository;
use FairEvents\Models\EventDates;
use FairEventsExperimental\Frontend\WeeklySummaryPage;
use FairEventsExperimental\WhatsApp\ReminderDispatcher;
use FairEventsExperimental\WhatsApp\ReminderRuns;
use FairEventsExperimental\WhatsApp\ReminderSchedule;
use FairEventsExperimental\WhatsApp\SharingReminders;

require_once __DIR__ . '/../lib/event-factory.php';

$fixture_step = isset( $args[0] ) ? (string) $args[0] : '';
$out          = array();

if ( 'feed' === $fixture_step ) {
	$suffix   = strtolower( sanitize_key( (string) ( $args[1] ?? 'feed' ) ) ) . '-' . gmdate( 'His' ) . wp_rand( 100, 999 );
	$category = wp_insert_term( 'E2E reminders ' . $suffix, 'category' );
	if ( is_wp_error( $category ) ) {
		WP_CLI::error( 'Failed to create category: ' . $category->get_error_message() );
	}
	$page_id   = wp_insert_post(
		array(
			'post_type'   => 'page',
			'post_status' => 'publish',
			'post_title'  => 'E2E reminders page ' . $suffix,
		)
	);
	$slug      = 'e2e-reminders-' . $suffix;
	$source_id = ( new EventSourceRepository() )->create(
		'E2E reminders ' . $suffix,
		$slug,
		array(
			array(
				'source_type' => 'categories',
				'config'      => array( 'category_ids' => array( (int) $category['term_id'] ) ),
			),
		),
		true,
		$page_id
	);
	if ( ! $source_id ) {
		WP_CLI::error( 'Failed to create event feed.' );
	}
	$out = array(
		'termId'     => (int) $category['term_id'],
		'pageId'     => (int) $page_id,
		'sourceId'   => (int) $source_id,
		'name'       => 'E2E reminders ' . $suffix,
		'slug'       => $slug,
		'summaryUrl' => WeeklySummaryPage::url( $slug ),
	);
} elseif ( 'event' === $fixture_step ) {
	if ( ! preg_match( '/^(\d{4})-W(\d{2})$/', (string) ( $args[2] ?? '' ), $week ) ) {
		WP_CLI::error( 'Expected an ISO week such as 2037-W10.' );
	}
	$wednesday = ( new DateTimeImmutable( 'now', new DateTimeZone( 'UTC' ) ) )->setISODate( (int) $week[1], (int) $week[2], 3 )->format( 'Y-m-d' );
	$event_id  = fair_e2e_create_event( 'E2E reminder event ' . wp_rand( 1000, 9999 ), '<!-- wp:paragraph --><p>Reminder fixture.</p><!-- /wp:paragraph -->' );
	wp_set_object_terms( $event_id, array( (int) $args[1] ), 'category' );
	if ( ! EventDates::save( $event_id, $wednesday . ' 18:00:00', $wednesday . ' 20:00:00', false ) ) {
		WP_CLI::error( 'Failed to create event date.' );
	}
	$out = array( 'eventId' => $event_id );
} elseif ( 'rename' === $fixture_step ) {
	$repo   = new EventSourceRepository();
	$source = $repo->get_by_id( (int) $args[1] );
	if ( ! $source ) {
		WP_CLI::error( 'No such feed.' );
	}
	$repo->update( (int) $source['id'], $source['name'], (string) $args[2], $source['data_sources'], (bool) $source['enabled'], $source['page_id'] );
	$out = array( 'summaryUrl' => WeeklySummaryPage::url( (string) $args[2] ) );
} elseif ( 'run' === $fixture_step ) {
	$out = ( new ReminderDispatcher() )->run( (string) ( $args[1] ?? '' ), (int) ( $args[2] ?? 0 ) );
} elseif ( 'next' === $fixture_step ) {
	$out = array( 'next' => ReminderSchedule::next_run( (int) ( $args[1] ?? 0 ) ) );
} elseif ( 'cleanup' === $fixture_step ) {
	global $wpdb;
	$created = json_decode( (string) ( $args[1] ?? '{}' ), true );
	$created = is_array( $created ) ? $created : array();
	foreach ( (array) ( $created['eventIds'] ?? array() ) as $event_id ) {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script.
		$wpdb->delete( $wpdb->prefix . 'fair_event_dates', array( 'event_id' => (int) $event_id ), array( '%d' ) );
		wp_delete_post( (int) $event_id, true );
	}
	foreach ( (array) ( $created['sourceIds'] ?? array() ) as $source_id ) {
		ReminderSchedule::unschedule( (int) $source_id );
		SharingReminders::delete( (int) $source_id );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script.
		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', ReminderRuns::table_name() ) ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script.
			$wpdb->delete( ReminderRuns::table_name(), array( 'source_id' => (int) $source_id ), array( '%d' ) );
		}
		( new EventSourceRepository() )->delete( (int) $source_id );
	}
	foreach ( (array) ( $created['pageIds'] ?? array() ) as $page_id ) {
		wp_delete_post( (int) $page_id, true );
	}
	foreach ( (array) ( $created['termIds'] ?? array() ) as $term_id ) {
		wp_delete_term( (int) $term_id, 'category' );
	}
	$out = array( 'cleaned' => true );
} else {
	WP_CLI::error( 'Usage: whatsapp-reminders-fixture.php feed | event | rename | run | next | cleanup' );
}

echo 'E2E_REMINDERS:' . wp_json_encode( $out ) . "\n";
