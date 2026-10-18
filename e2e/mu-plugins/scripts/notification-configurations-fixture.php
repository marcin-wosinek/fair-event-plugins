<?php
/**
 * Fixture for event notification configurations (#1919).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/notification-configurations-fixture.php reset <type>...
 *   wp eval-file wp-content/mu-plugins/scripts/notification-configurations-fixture.php remove <id>...
 *   wp eval-file wp-content/mu-plugins/scripts/notification-configurations-fixture.php state <id>
 *   wp eval-file wp-content/mu-plugins/scripts/notification-configurations-fixture.php run <id>
 *
 * `reset` puts the configuration a type started with (its ID is the type)
 * back to the type's defaults, turned off, without history, queued sends or
 * delivery records. `remove` deletes configurations a spec added: the
 * administration offers no deletion yet. `state` reports a configuration's
 * queued sends, next send, history and last sent week. `run` executes an
 * individual email configuration's cron callback for the current send week,
 * exactly as WP-Cron would.
 *
 * Prints a single `E2E_NOTIFICATION_CONFIGURATIONS:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Notifications\BulkEmailDispatcher;
use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\DeliveryLog;
use FairEvents\Notifications\IndividualEmailDispatcher;
use FairEvents\Notifications\ScheduledSends;

$fixture_action = $args[0] ?? '';
$fixture_ids    = array_slice( $args, 1 );
$fixture_hooks  = array(
	Configurations::TELEGRAM         => 'fair_events_notification_telegram',
	Configurations::BULK_EMAIL       => 'fair_events_notification_bulk_email',
	Configurations::INDIVIDUAL_EMAIL => 'fair_events_notification_individual_email',
);

// Everything a configuration keeps besides its record.
$fixture_clear = static function ( $config_id, $config_type ) use ( $fixture_hooks ) {
	global $wpdb;
	ScheduledSends::clear( $fixture_hooks[ $config_type ], $config_id );
	foreach ( array( 'next_run', 'runs', 'last_sent_week' ) as $suffix ) {
		delete_option( Configurations::option( $config_id, $suffix ) );
	}
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test teardown.
	$wpdb->delete( DeliveryLog::table_name(), array( 'config_id' => $config_id ), array( '%s' ) );
};

$out = array();
if ( 'reset' === $fixture_action ) {
	foreach ( $fixture_ids as $fixture_type ) {
		if ( ! isset( $fixture_hooks[ $fixture_type ] ) ) {
			WP_CLI::error( "Unknown type {$fixture_type}." );
		}
		$fixture_id = Configurations::legacy_id( $fixture_type );
		Configurations::create( $fixture_type, '', array(), $fixture_id );
		Configurations::update(
			$fixture_id,
			array(
				'name'     => '',
				'settings' => array(),
			)
		);
		$fixture_clear( $fixture_id, $fixture_type );
	}
	$out = array( 'reset' => $fixture_ids );
} elseif ( 'remove' === $fixture_action ) {
	$fixture_index = get_option( Configurations::INDEX_OPTION, array() );
	foreach ( $fixture_ids as $fixture_id ) {
		$fixture_record = Configurations::get( $fixture_id );
		if ( ! $fixture_record || Configurations::legacy_id( $fixture_record['type'] ) === $fixture_id ) {
			continue;
		}
		$fixture_clear( $fixture_id, $fixture_record['type'] );
		delete_option( Configurations::option( $fixture_id ) );
		$fixture_index = array_values(
			array_filter(
				$fixture_index,
				static function ( $entry ) use ( $fixture_id ) {
					return $entry['id'] !== $fixture_id;
				}
			)
		);
	}
	update_option( Configurations::INDEX_OPTION, $fixture_index, true );
	$out = array( 'removed' => $fixture_ids );
} elseif ( 'run' === $fixture_action ) {
	IndividualEmailDispatcher::handle( BulkEmailDispatcher::iso_week( BulkEmailDispatcher::now() ), $fixture_ids[0] ?? '' );
	$out = array( 'ran' => $fixture_ids[0] ?? '' );
} elseif ( 'state' === $fixture_action ) {
	$fixture_id     = $fixture_ids[0] ?? '';
	$fixture_record = Configurations::get( $fixture_id );
	if ( ! $fixture_record ) {
		WP_CLI::error( "Unknown configuration {$fixture_id}." );
	}
	$fixture_queued = array();
	foreach ( ScheduledSends::events( $fixture_hooks[ $fixture_record['type'] ] ) as list( $timestamp, $hook_args ) ) {
		if ( ( $hook_args[1] ?? '' ) === $fixture_id ) {
			$fixture_queued[] = array(
				'timestamp' => $timestamp,
				'week'      => $hook_args[0],
			);
		}
	}
	$out = array(
		'queued'       => $fixture_queued,
		'nextRun'      => get_option( Configurations::option( $fixture_id, 'next_run' ), null ),
		'runs'         => array_values( (array) get_option( Configurations::option( $fixture_id, 'runs' ), array() ) ),
		'lastSentWeek' => BulkEmailDispatcher::last_sent_week( $fixture_id ),
	);
} else {
	WP_CLI::error( 'Expected reset <type>..., remove <id>..., state <id> or run <id>.' );
}

echo 'E2E_NOTIFICATION_CONFIGURATIONS:' . wp_json_encode( (object) $out ) . "\n";
