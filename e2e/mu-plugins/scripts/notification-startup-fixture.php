<?php
/**
 * Fixture for event notification startup timing (#2059).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/notification-startup-fixture.php enable
 *   wp eval-file wp-content/mu-plugins/scripts/notification-startup-fixture.php disable
 *   wp eval-file wp-content/mu-plugins/scripts/notification-startup-fixture.php reset <fresh|pending|interrupted>
 *   wp eval-file wp-content/mu-plugins/scripts/notification-startup-fixture.php state
 *   wp eval-file wp-content/mu-plugins/scripts/notification-startup-fixture.php due-cleanup
 *   wp eval-file wp-content/mu-plugins/scripts/notification-startup-fixture.php hold-lock <seconds>
 *
 * `enable` turns on the startup stand-ins of fair-e2e-notification-startup.php,
 * refuses outgoing requests to remote hosts and clears the startup log.
 * `disable` turns both off again.
 *
 * `reset` puts the notification data back where an earlier release left it,
 * for the next request's startup to take over: `fresh` removes every
 * takeover, upgrade and import marker and the history cleanup event (tables
 * and their contents stay, so other specs keep their data), `pending` removes
 * the configuration and history markers of an upgrade not run yet, and
 * `interrupted` removes the individual email history marker, as when an
 * import stopped before writing it. Each also stores one individual email
 * run dated before the history began, which the import picks up.
 *
 * `state` reports the markers, queued notification cron events, imported
 * history, delivery claims, a fingerprint of the saved settings, the
 * captured outbound messages and the startup log. `due-cleanup` moves the
 * history cleanup event into the past for the next cron request.
 *
 * `hold-lock` applies the `pending` reset, then holds the migration lock for
 * the given seconds, as a request still migrating would; the
 * `fair_e2e_notification_startup_lock_held` option is set while it does.
 *
 * These runs skip notification startup and never add to the startup log
 * (fair-e2e-notification-startup.php recognizes them). Prints a single
 * `E2E_NOTIFICATION_STARTUP:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Notifications\ConfigurationMigration;
use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\DeliveryLog;
use FairEvents\Notifications\ExecutionHistory;
use FairEvents\Notifications\HistoryMigration;
use FairEvents\Notifications\HistoryTables;
use FairEvents\Notifications\Lock;
use FairEvents\Notifications\Notifications;
use FairEvents\Notifications\Ownership;
use FairEvents\Notifications\TelegramSettings;

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test fixture.

global $wpdb;
$fixture_action = $args[0] ?? '';
$fixture_id     = Configurations::legacy_id( Configurations::INDIVIDUAL_EMAIL );
$fixture_run    = 'e2e-2059';
$fixture_hooks  = array(
	Notifications::HISTORY_CLEANUP_HOOK,
	'fair_events_notification_telegram',
	'fair_events_notification_bulk_email',
	'fair_events_notification_individual_email',
);
$out            = array();

$fixture_reset = static function ( $state ) use ( $fixture_id, $fixture_run ) {
	if ( 'fresh' === $state ) {
		delete_option( Ownership::OPTION );
		delete_option( DeliveryLog::DB_VERSION_OPTION );
		delete_option( HistoryTables::DB_VERSION_OPTION );
		wp_unschedule_hook( Notifications::HISTORY_CLEANUP_HOOK );
	}
	if ( 'interrupted' === $state ) {
		$markers = get_option( HistoryMigration::OPTION, array() );
		unset( $markers[ Configurations::INDIVIDUAL_EMAIL ] );
		update_option( HistoryMigration::OPTION, $markers, false );
	} else {
		delete_option( ConfigurationMigration::OPTION );
		delete_option( HistoryMigration::OPTION );
	}

	// Ten days before the history began, so the import picks it up.
	$time = gmdate( 'Y-m-d H:i:s', strtotime( HistoryTables::since() . ' UTC' ) - 10 * DAY_IN_SECONDS );
	$runs = get_option( Configurations::option( $fixture_id, 'runs' ), array() );
	$runs = is_array( $runs ) ? $runs : array();

	$runs[ $fixture_run ] = array(
		'send_week'   => $fixture_run,
		'week_start'  => substr( $time, 0, 10 ),
		'week_end'    => substr( $time, 0, 10 ),
		'destination' => 'startup-2059@example.test',
		'status'      => 'sent',
		'message'     => 'Handed over to the site’s mail system.',
		'time'        => $time,
	);
	update_option( Configurations::option( $fixture_id, 'runs' ), $runs, false );

	return array(
		'reset'  => $state,
		'seeded' => '' !== HistoryTables::since(),
	);
};

if ( 'enable' === $fixture_action ) {
	update_option( 'fair_e2e_notification_startup', 1, false );
	update_option( 'fair_e2e_block_external_http', 1, false );
	delete_option( 'fair_e2e_notification_startup_log' );
	$out = array( 'enabled' => true );
} elseif ( 'disable' === $fixture_action ) {
	delete_option( 'fair_e2e_notification_startup' );
	delete_option( 'fair_e2e_block_external_http' );
	delete_option( 'fair_e2e_notification_startup_log' );
	delete_option( 'fair_e2e_notification_startup_lock_held' );
	$out = array( 'enabled' => false );
} elseif ( 'reset' === $fixture_action ) {
	$out = $fixture_reset( $args[1] ?? '' );
} elseif ( 'state' === $fixture_action ) {
	$events = array();
	foreach ( (array) _get_cron_array() as $hooks ) {
		foreach ( $fixture_hooks as $hook ) {
			foreach ( array_keys( $hooks[ $hook ] ?? array() ) as $key ) {
				$events[ $hook . '|' . $key ] = ( $events[ $hook . '|' . $key ] ?? 0 ) + 1;
			}
		}
	}

	// What is stored: an explicit default skips the token's registered one,
	// which appears only once Fair Events owns Telegram.
	$settings = array(
		Configurations::INDEX_OPTION   => get_option( Configurations::INDEX_OPTION ),
		TelegramSettings::TOKEN_OPTION => get_option( TelegramSettings::TOKEN_OPTION, false ),
	);
	foreach ( Configurations::all() as $configuration ) {
		$settings[ $configuration['id'] ] = get_option( Configurations::option( $configuration['id'] ) );
	}

	$executions = ExecutionHistory::table_name();
	$out        = array(
		'markers'       => array(
			'telegram'      => Ownership::is_migrated( Ownership::TELEGRAM ),
			'bulkEmail'     => Ownership::is_migrated( Ownership::BULK_EMAIL ),
			'ownership'     => get_option( Ownership::OPTION ),
			'deliveries'    => DeliveryLog::is_current(),
			'configuration' => ConfigurationMigration::is_complete(),
			'tables'        => HistoryTables::is_current(),
			'history'       => HistoryMigration::is_complete(),
		),
		'cleanupEvents' => count( array_filter( array_keys( $events ), static fn( $key ) => 0 === strpos( $key, Notifications::HISTORY_CLEANUP_HOOK . '|' ) ) ),
		'duplicateCron' => array_keys( array_filter( $events, static fn( $count ) => $count > 1 ) ),
		'imported'      => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE source_key = %s', $executions, 'legacy-run|' . $fixture_id . '|' . $fixture_run ) ),
		'importedTotal' => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE source_key LIKE %s', $executions, 'legacy-run|%' ) ),
		'claims'        => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', DeliveryLog::table_name() ) ),
		'settings'      => md5( maybe_serialize( $settings ) ),
		'mail'          => count( (array) get_option( 'fair_e2e_captured_mail', array() ) ),
		'telegram'      => count( (array) get_option( 'fair_e2e_telegram_requests', array() ) ),
		'lockFree'      => '1' === (string) $wpdb->get_var( $wpdb->prepare( 'SELECT IS_FREE_LOCK(%s)', Lock::MIGRATION . '_' . md5( DB_NAME . $wpdb->prefix ) ) ),
		'log'           => (array) get_option( 'fair_e2e_notification_startup_log', array() ),
	);
} elseif ( 'due-cleanup' === $fixture_action ) {
	wp_unschedule_hook( Notifications::HISTORY_CLEANUP_HOOK );
	wp_schedule_event( time() - MINUTE_IN_SECONDS, 'daily', Notifications::HISTORY_CLEANUP_HOOK );
	delete_transient( 'doing_cron' );
	$out = array( 'due' => (bool) wp_next_scheduled( Notifications::HISTORY_CLEANUP_HOOK ) );
} elseif ( 'hold-lock' === $fixture_action ) {
	$fixture_reset( 'pending' );
	if ( Lock::acquire( Lock::MIGRATION ) ) {
		update_option( 'fair_e2e_notification_startup_lock_held', 1, false );
		sleep( max( 1, (int) ( $args[1] ?? 5 ) ) );
		delete_option( 'fair_e2e_notification_startup_lock_held' );
		Lock::release( Lock::MIGRATION );
		$out = array( 'held' => true );
	} else {
		$out = array( 'held' => false );
	}
}

echo 'E2E_NOTIFICATION_STARTUP:' . wp_json_encode( $out ) . "\n";
