<?php
/**
 * Fixture for the individual email notification E2E spec (#1852).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/individual-email-fixture.php events <preview|now>
 *   wp eval-file wp-content/mu-plugins/scripts/individual-email-fixture.php run
 *   wp eval-file wp-content/mu-plugins/scripts/individual-email-fixture.php state
 *   wp eval-file wp-content/mu-plugins/scripts/individual-email-fixture.php cleanup <eventId>...
 *   wp eval-file wp-content/mu-plugins/scripts/individual-email-fixture.php hide-sources
 *   wp eval-file wp-content/mu-plugins/scripts/individual-email-fixture.php restore-sources <sourceId>...
 *
 * `events` publishes one event and drafts another, both dated inside the week
 * an email covers under the saved settings: a preview/test (`preview`) or a scheduled email sent right now (`now`).
 * `run` executes the scheduled send's cron callback for the current send
 * week, exactly as WP-Cron would. `state` reports the schedule and history.
 * `cleanup` removes the given events. `hide-sources` disables every enabled
 * event feed, so the site looks like one that never had any, and reports
 * their IDs for `restore-sources`.
 *
 * Prints a single `E2E_INDIVIDUAL_EMAIL:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\EventDates;
use FairEvents\Notifications\BulkEmailDispatcher;
use FairEvents\Notifications\IndividualEmailDispatcher;
use FairEvents\Notifications\IndividualEmailSettings;

require_once __DIR__ . '/../lib/event-factory.php';

$fixture_step = isset( $args[0] ) ? (string) $args[0] : '';
$out          = array();

$fixture_state = static function () {
	return array(
		'nextRun'      => IndividualEmailDispatcher::next_run(),
		'lastSentWeek' => (string) get_option( IndividualEmailDispatcher::LAST_SENT_OPTION, '' ),
		'runs'         => IndividualEmailDispatcher::runs(),
	);
};

if ( 'events' === $fixture_step ) {
	$settings = IndividualEmailSettings::get();
	$now      = BulkEmailDispatcher::now();
	$week     = IndividualEmailDispatcher::event_week( $settings['week_scope'], $now );
	$start    = gmdate( 'Y-m-d', strtotime( $week['start'] . ' +3 days' ) ) . ' 18:00:00';
	$suffix   = wp_rand( 1000, 9999 );
	$content  = '<!-- wp:paragraph --><p>Individual email fixture.</p><!-- /wp:paragraph -->';

	$event_title = 'E2E Individual <Jam> & Friends ' . $suffix;
	$event_id    = fair_e2e_create_event( $event_title, $content );
	// EventDates::save() links the date to the post, as the event editor does.
	if ( ! EventDates::save( $event_id, $start, gmdate( 'Y-m-d H:i:s', strtotime( $start . ' +2 hours' ) ), false ) ) {
		WP_CLI::error( 'Failed to create event date.' );
	}

	$draft_title = 'E2E Individual Draft ' . $suffix;
	$draft_id    = fair_e2e_create_event( $draft_title, $content );
	if ( ! EventDates::save( $draft_id, $start, gmdate( 'Y-m-d H:i:s', strtotime( $start . ' +2 hours' ) ), false ) ) {
		WP_CLI::error( 'Failed to create draft event date.' );
	}
	wp_update_post(
		array(
			'ID'          => $draft_id,
			'post_status' => 'draft',
		)
	);

	$out = array(
		'eventId'    => $event_id,
		'eventTitle' => $event_title,
		'eventUrl'   => get_permalink( $event_id ),
		'draftId'    => $draft_id,
		'draftTitle' => $draft_title,
		'weekStart'  => $week['start'],
	);
} elseif ( 'run' === $fixture_step ) {
	IndividualEmailDispatcher::handle( BulkEmailDispatcher::iso_week( BulkEmailDispatcher::now() ) );
	$out = $fixture_state();
} elseif ( 'state' === $fixture_step ) {
	$out = $fixture_state();
} elseif ( 'cleanup' === $fixture_step ) {
	global $wpdb;
	foreach ( array_slice( $args, 1 ) as $event_id ) {
		$event_id = (int) $event_id;
		if ( ! $event_id ) {
			continue;
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script.
		$wpdb->delete( $wpdb->prefix . 'fair_event_dates', array( 'event_id' => $event_id ), array( '%d' ) );
		wp_delete_post( $event_id, true );
	}
	$out = array( 'cleaned' => true );
} elseif ( 'hide-sources' === $fixture_step || 'restore-sources' === $fixture_step ) {
	global $wpdb;
	$sources_table = $wpdb->prefix . 'fair_event_sources';
	$hide          = 'hide-sources' === $fixture_step;
	// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off fixture script.
	$source_ids = $hide
		? array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE enabled = 1', $sources_table ) ) )
		: array_filter( array_map( 'intval', array_slice( $args, 1 ) ) );
	foreach ( $source_ids as $source_id ) {
		$wpdb->update( $sources_table, array( 'enabled' => $hide ? 0 : 1 ), array( 'id' => $source_id ), array( '%d' ), array( '%d' ) );
	}
	// phpcs:enable
	$out = array( 'sourceIds' => array_values( $source_ids ) );
} else {
	WP_CLI::error( 'Usage: individual-email-fixture.php events <preview|now> | run | state | cleanup <eventId>... | hide-sources | restore-sources <sourceId>...' );
}

echo 'E2E_INDIVIDUAL_EMAIL:' . wp_json_encode( $out ) . "\n";
