<?php
/**
 * Fixture for the notification execution history (#1920).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/notification-history-fixture.php schema
 *   wp eval-file wp-content/mu-plugins/scripts/notification-history-fixture.php clear <id>...
 *   wp eval-file wp-content/mu-plugins/scripts/notification-history-fixture.php claims <id>
 *   wp eval-file wp-content/mu-plugins/scripts/notification-history-fixture.php seed-legacy <telegramId> <individualId>
 *   wp eval-file wp-content/mu-plugins/scripts/notification-history-fixture.php stale <id>
 *   wp eval-file wp-content/mu-plugins/scripts/notification-history-fixture.php age <executionId> <days>
 *   wp eval-file wp-content/mu-plugins/scripts/notification-history-fixture.php cleanup
 *   wp eval-file wp-content/mu-plugins/scripts/notification-history-fixture.php run-bulk <id>
 *   wp eval-file wp-content/mu-plugins/scripts/notification-history-fixture.php participant <email>
 *   wp eval-file wp-content/mu-plugins/scripts/notification-history-fixture.php remove-participant <participantId>
 *
 * `schema` reports the history tables' version and unique keys. `clear`
 * deletes configurations' executions and deliveries, and `claims` counts a
 * configuration's delivery claims. `seed-legacy` stores run records and
 * delivery claims dated before the history existed, as an older release kept
 * them, then runs the migration twice the way a request would. `stale` adds
 * a running execution whose worker stopped an hour ago, with an attempt
 * still waiting for its outcome. `age` moves an execution's start back and
 * `cleanup` runs the daily history cleanup. `run-bulk` executes a group email
 * configuration's cron callback for the current send week, exactly as
 * WP-Cron would. `participant` adds a Fair Audience participant who accepts
 * the weekly summary.
 *
 * Prints a single `E2E_NOTIFICATION_HISTORY:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairAudience\Models\Participant;
use FairEvents\Notifications\BulkEmailDispatcher;
use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\DeliveryHistory;
use FairEvents\Notifications\DeliveryLog;
use FairEvents\Notifications\ExecutionHistory;
use FairEvents\Notifications\HistoryMigration;
use FairEvents\Notifications\HistoryTables;
use FairEvents\Notifications\Migration;
use FairEvents\Notifications\Notifications;

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test fixture.

global $wpdb;
$fixture_action     = $args[0] ?? '';
$fixture_executions = ExecutionHistory::table_name();
$fixture_deliveries = DeliveryHistory::table_name();
$out                = array();

$fixture_unique_keys = static function ( $table ) use ( $wpdb ) {
	return array_values(
		array_unique(
			$wpdb->get_col( $wpdb->prepare( 'SHOW INDEX FROM %i WHERE Non_unique = 0', $table ), 2 )
		)
	);
};

if ( 'schema' === $fixture_action ) {
	$out = array(
		'version'          => get_option( HistoryTables::DB_VERSION_OPTION ),
		'executionKeys'    => $fixture_unique_keys( $fixture_executions ),
		'deliveryKeys'     => $fixture_unique_keys( $fixture_deliveries ),
		'migrated'         => HistoryMigration::is_complete(),
		'cleanupScheduled' => (bool) wp_next_scheduled( Notifications::HISTORY_CLEANUP_HOOK ),
	);
} elseif ( 'clear' === $fixture_action ) {
	foreach ( array_slice( $args, 1 ) as $fixture_id ) {
		$wpdb->query( $wpdb->prepare( 'DELETE d FROM %i d JOIN %i e ON e.id = d.execution_id WHERE e.config_id = %s', $fixture_deliveries, $fixture_executions, $fixture_id ) );
		$wpdb->delete( $fixture_executions, array( 'config_id' => $fixture_id ), array( '%s' ) );
	}
	$out = array( 'cleared' => array_slice( $args, 1 ) );
} elseif ( 'claims' === $fixture_action ) {
	$out = array( 'claims' => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE config_id = %s', DeliveryLog::table_name(), $args[1] ?? '' ) ) );
} elseif ( 'seed-legacy' === $fixture_action ) {
	$fixture_telegram   = $args[1] ?? '';
	$fixture_individual = $args[2] ?? '';
	$fixture_since      = HistoryTables::since();
	// Before the history tables existed; claim rows are kept for 365 days.
	$fixture_old            = gmdate( 'Y-m-d H:i:s', strtotime( $fixture_since . ' UTC' ) - 20 * DAY_IN_SECONDS );
	$fixture_old_week       = gmdate( 'Y-m-d', strtotime( 'monday this week', strtotime( $fixture_old . ' UTC' ) ) );
	$fixture_unmatched_week = gmdate( 'Y-m-d', strtotime( $fixture_old_week . ' UTC' ) - 14 * DAY_IN_SECONDS );
	$fixture_send_week      = gmdate( 'o-\WW', strtotime( $fixture_old_week . ' UTC' ) );

	update_option(
		Configurations::option( $fixture_telegram, 'runs' ),
		array(
			$fixture_old_week => array(
				'week_start' => $fixture_old_week,
				'week_end'   => gmdate( 'Y-m-d', strtotime( $fixture_old_week . ' UTC' ) + 6 * DAY_IN_SECONDS ),
				'status'     => 'partial',
				'message'    => 'Delivered: 1. Failed: 1. Unknown outcome: 0.',
				'counts'     => array(
					'sent'      => 1,
					'failed'    => 1,
					'uncertain' => 0,
					'duplicate' => 0,
				),
				'time'       => $fixture_old,
			),
		),
		false
	);
	update_option(
		Configurations::option( $fixture_individual, 'runs' ),
		array(
			$fixture_send_week => array(
				'send_week'   => $fixture_send_week,
				'week_start'  => $fixture_old_week,
				'week_end'    => gmdate( 'Y-m-d', strtotime( $fixture_old_week . ' UTC' ) + 6 * DAY_IN_SECONDS ),
				'destination' => 'legacy-1920@example.test',
				'status'      => 'sent',
				'message'     => 'Handed over to the site’s mail system.',
				'time'        => $fixture_old,
			),
		),
		false
	);

	$fixture_claim = static function ( $config_id, $week, $provider, $destination, $part, $part_count, $state, $code ) use ( $wpdb, $fixture_old ) {
		$wpdb->replace(
			DeliveryLog::table_name(),
			array(
				'config_id'   => $config_id,
				'week_start'  => $week,
				'provider'    => $provider,
				'destination' => $destination,
				'part'        => $part,
				'part_count'  => $part_count,
				'state'       => $state,
				'error_code'  => $code,
				'created_at'  => $fixture_old,
				'updated_at'  => $fixture_old,
			)
		);
	};
	$fixture_claim( $fixture_telegram, $fixture_old_week, 'telegram', '@legacy_one', 1, 1, 'sent', '' );
	$fixture_claim( $fixture_telegram, $fixture_old_week, 'telegram', '@legacy_two', 1, 2, 'failed', 'http_400' );
	$fixture_claim( $fixture_telegram, $fixture_old_week, 'telegram', '@legacy_two', 2, 2, 'skipped', 'previous_part_not_sent' );
	$fixture_claim( $fixture_telegram, $fixture_unmatched_week, 'telegram', '@legacy_one', 1, 1, 'uncertain', 'internal_error' );
	$fixture_claim( $fixture_individual, $fixture_old_week, 'individual_email', 'recipient', 1, 1, 'sent', '' );

	// Start the import over for these types, as on a site that never ran it.
	$fixture_state = get_option( HistoryMigration::OPTION, array() );
	unset( $fixture_state['telegram'], $fixture_state['individual_email'] );
	update_option( HistoryMigration::OPTION, $fixture_state, true );
	Migration::run();
	$fixture_first = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $fixture_executions ) );
	$fixture_state = get_option( HistoryMigration::OPTION, array() );
	unset( $fixture_state['telegram'], $fixture_state['individual_email'] );
	update_option( HistoryMigration::OPTION, $fixture_state, true );
	Migration::run();

	$out = array(
		'weekStart'          => $fixture_old_week,
		'unmatchedWeek'      => $fixture_unmatched_week,
		'sendWeek'           => $fixture_send_week,
		'migrated'           => HistoryMigration::is_complete(),
		'executionsAfterOne' => $fixture_first,
		'executionsAfterTwo' => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $fixture_executions ) ),
	);
} elseif ( 'stale' === $fixture_action ) {
	$fixture_history = new ExecutionHistory();
	$fixture_begun   = $fixture_history->begin(
		array(
			'config_id'  => $args[1] ?? '',
			'channel'    => Configurations::INDIVIDUAL_EMAIL,
			'origin'     => 'test',
			'occurrence' => '',
		)
	);
	$fixture_history->attempt(
		$fixture_begun['id'],
		array( 'recipient' => 'stale-1920@example.test' )
	);
	$wpdb->update(
		$fixture_executions,
		array( 'heartbeat_at' => gmdate( 'Y-m-d H:i:s', time() - HOUR_IN_SECONDS ) ),
		array( 'id' => $fixture_begun['id'] )
	);
	$out = array( 'executionId' => $fixture_begun['id'] );
} elseif ( 'age' === $fixture_action ) {
	$wpdb->update(
		$fixture_executions,
		array( 'started_at' => gmdate( 'Y-m-d H:i:s', time() - (int) ( $args[2] ?? 0 ) * DAY_IN_SECONDS ) ),
		array( 'id' => (int) ( $args[1] ?? 0 ) )
	);
	$out = array( 'aged' => (int) ( $args[1] ?? 0 ) );
} elseif ( 'cleanup' === $fixture_action ) {
	Notifications::clean_up_history();
	$out = array( 'cleaned' => true );
} elseif ( 'run-bulk' === $fixture_action ) {
	BulkEmailDispatcher::handle( BulkEmailDispatcher::iso_week( BulkEmailDispatcher::now() ), $args[1] ?? '' );
	$out = array( 'ran' => $args[1] ?? '' );
} elseif ( 'participant' === $fixture_action ) {
	$fixture_participant = new Participant(
		array(
			'name'          => 'History 1920',
			'email'         => $args[1] ?? '',
			'email_profile' => 'marketing',
			'status'        => 'confirmed',
		)
	);
	if ( ! $fixture_participant->save() ) {
		WP_CLI::error( 'Failed to create participant.' );
	}
	$out = array( 'participantId' => (int) $fixture_participant->id );
} elseif ( 'remove-participant' === $fixture_action ) {
	$wpdb->delete( $wpdb->prefix . 'fair_audience_participants', array( 'id' => (int) ( $args[1] ?? 0 ) ), array( '%d' ) );
	$out = array( 'removed' => (int) ( $args[1] ?? 0 ) );
} else {
	WP_CLI::error( 'Expected schema, clear, claims, seed-legacy, stale, age, cleanup, run-bulk, participant or remove-participant.' );
}

echo 'E2E_NOTIFICATION_HISTORY:' . wp_json_encode( (object) $out ) . "\n";
