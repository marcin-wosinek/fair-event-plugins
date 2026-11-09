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
 *   wp eval-file wp-content/mu-plugins/scripts/notification-startup-fixture.php drop-recurring
 *   wp eval-file wp-content/mu-plugins/scripts/notification-startup-fixture.php contend
 *   wp eval-file wp-content/mu-plugins/scripts/notification-startup-fixture.php hold-lock <ready-file> <release-file> <seconds>
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
 * `drop-recurring` removes every recurring event the Fair plugins own, as
 * after a deactivation or a failed schedule, for the next startup to restore.
 *
 * `contend` runs a page startup while another process is migrating (#2188).
 * It applies the `pending` reset, starts `hold-lock` as a separate WP-CLI
 * process, waits until that process confirms it holds the migration lock,
 * reads the state, requests a page from the tests web server over the
 * container network and reads the state again, then lets the holder release
 * the lock and waits for it to exit. It reports the state before and during
 * contention, the page request's startup log entry and the holder's output,
 * exit code and signal. Every wait is bounded; on any failure it stops the
 * holder, removes its signal files and reports `ok: false` with an `error`
 * and the `stage` it reached instead of failing the WP-CLI run.
 *
 * The whole concurrent phase runs in this one WP-CLI process: concurrent
 * `wp-env run` calls from the spec broke the wp-env environment for every
 * later spec in the CI shard. State is read through fresh child processes, so
 * no option cache of this process gets in the way.
 *
 * `hold-lock` takes the migration lock, writes the ready file and holds the
 * lock until the release file appears, at most the given seconds. It fails
 * when the lock is taken or the release never comes.
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
// phpcs:disable WordPress.PHP.DiscouragedPHPFunctions.system_calls_proc_open, WordPress.WP.AlternativeFunctions, WordPress.Security.EscapeOutput.ExceptionNotEscaped -- `contend` runs WP-CLI children and a page request in the test container.

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
} elseif ( 'drop-recurring' === $fixture_action ) {
	// Runs after this process's own startup, so nothing restores them before the next request.
	$dropped = array();
	foreach ( array_keys( fair_e2e_notification_startup_expected_recurring() ) as $hook ) {
		$dropped[ $hook ] = (int) wp_unschedule_hook( $hook );
	}
	$out = array( 'dropped' => $dropped );
} elseif ( 'hold-lock' === $fixture_action ) {
	$fixture_ready   = (string) ( $args[1] ?? '' );
	$fixture_release = (string) ( $args[2] ?? '' );
	$fixture_limit   = max( 1, (int) ( $args[3] ?? 60 ) );
	if ( '' === $fixture_ready || '' === $fixture_release ) {
		WP_CLI::error( 'hold-lock needs a ready file and a release file.' );
	}
	if ( ! Lock::acquire( Lock::MIGRATION ) ) {
		WP_CLI::error( 'The notification migration lock is already taken.' );
	}
	$fixture_since = microtime( true );
	file_put_contents( $fixture_ready, (string) getmypid() );
	while ( ! file_exists( $fixture_release ) && microtime( true ) - $fixture_since < $fixture_limit ) {
		usleep( 100000 );
	}
	$fixture_released = file_exists( $fixture_release );
	Lock::release( Lock::MIGRATION );
	if ( ! $fixture_released ) {
		WP_CLI::error( "No release signal within {$fixture_limit} s; released the lock." );
	}
	$out = array(
		'held'    => true,
		'seconds' => round( microtime( true ) - $fixture_since, 1 ),
	);
} elseif ( 'contend' === $fixture_action ) {
	// Starts `wp eval-file <this file> <args>` with its output in files, so a
	// chatty child cannot block on a full pipe.
	$fixture_spawn = static function ( array $child_args ) {
		$child = array(
			'args'    => $child_args,
			'stdout'  => wp_tempnam( 'e2e-2059-out' ),
			'stderr'  => wp_tempnam( 'e2e-2059-err' ),
			'status'  => null,
			'process' => null,
		);
		$pipes = array();
		// An argument list, not a shell command: terminating the process
		// stops WP-CLI itself.
		$process = proc_open(
			array_merge( array( 'wp', 'eval-file', __FILE__ ), $child_args, array( '--path=' . ABSPATH ) ),
			array(
				0 => array( 'file', '/dev/null', 'r' ),
				1 => array( 'file', $child['stdout'], 'w' ),
				2 => array( 'file', $child['stderr'], 'w' ),
			),
			$pipes
		);
		if ( ! is_resource( $process ) ) {
			throw new RuntimeException( 'Could not start `' . implode( ' ', $child_args ) . '`.' );
		}
		$child['process'] = $process;
		return $child;
	};

	// Whether the child has exited, keeping its exit status: PHP reports it
	// only on the first status call after the exit.
	$fixture_exited = static function ( array &$child ) {
		if ( null === $child['status'] ) {
			$status = proc_get_status( $child['process'] );
			if ( ! $status['running'] ) {
				$child['status'] = $status;
			}
		}
		return null !== $child['status'];
	};

	// Waits until the child exits or `$until` holds; false at the deadline.
	$fixture_wait = static function ( array &$child, $seconds, $until = null ) use ( $fixture_exited ) {
		$deadline = microtime( true ) + $seconds;
		while ( true ) {
			if ( ( $until && $until() ) || $fixture_exited( $child ) ) {
				return true;
			}
			if ( microtime( true ) >= $deadline ) {
				return false;
			}
			usleep( 100000 );
		}
	};

	// Stops the child if it still runs and reports its output and exit.
	$fixture_finish = static function ( array &$child ) use ( $fixture_exited, $fixture_wait ) {
		$stopped = false;
		if ( ! $fixture_exited( $child ) ) {
			$stopped = true;
			proc_terminate( $child['process'], 15 );
			if ( ! $fixture_wait( $child, 5 ) ) {
				proc_terminate( $child['process'], 9 );
				$fixture_wait( $child, 5 );
			}
		}
		proc_close( $child['process'] );
		$status = $child['status'];
		$report = array(
			'command'  => 'wp eval-file ' . basename( __FILE__ ) . ' ' . implode( ' ', $child['args'] ),
			'stopped'  => $stopped,
			'exitCode' => $status && ! $status['signaled'] ? $status['exitcode'] : null,
			'signal'   => $status && $status['signaled'] ? $status['termsig'] : null,
			'stdout'   => (string) file_get_contents( $child['stdout'] ),
			'stderr'   => (string) file_get_contents( $child['stderr'] ),
		);
		wp_delete_file( $child['stdout'] );
		wp_delete_file( $child['stderr'] );
		return $report;
	};

	// The JSON a finished child printed, or null.
	$fixture_result = static function ( array $report ) {
		if ( 0 !== $report['exitCode'] || ! preg_match( '/E2E_NOTIFICATION_STARTUP:(\{.*\})/', $report['stdout'], $match ) ) {
			return null;
		}
		return json_decode( $match[1], true );
	};

	// The state, read by a fresh process.
	$fixture_state = static function () use ( $fixture_spawn, $fixture_wait, $fixture_finish, $fixture_result ) {
		$child  = $fixture_spawn( array( 'state' ) );
		$waited = $fixture_wait( $child, 30 );
		$report = $fixture_finish( $child );
		$state  = $fixture_result( $report );
		if ( ! $waited || null === $state ) {
			throw new RuntimeException( "Reading the state failed:\n" . wp_json_encode( $report, JSON_PRETTY_PRINT ) );
		}
		return $state;
	};

	// A real page request to the tests web server. From this container the
	// site's own address points at itself, so the request goes to the web
	// server's service name, with the site's host so WordPress does not
	// redirect it.
	$fixture_request = static function ( $path ) {
		$web_host = 'tests-wordpress';
		if ( gethostbyname( $web_host ) === $web_host ) {
			throw new RuntimeException( "Cannot resolve the tests web server '{$web_host}' from the WP-CLI container." );
		}
		$home    = wp_parse_url( home_url() );
		$host    = $home['host'] . ( isset( $home['port'] ) ? ':' . $home['port'] : '' );
		$context = stream_context_create(
			array(
				'http' => array(
					'header'          => "Host: {$host}\r\nConnection: close\r\n",
					'follow_location' => 0,
					'ignore_errors'   => true,
					'timeout'         => 30,
				),
			)
		);
		$body    = file_get_contents( 'http://' . $web_host . $path, false, $context );
		$headers = function_exists( 'http_get_last_response_headers' ) ? http_get_last_response_headers() : ( $http_response_header ?? array() );
		if ( false === $body || ! preg_match( '/^HTTP\/\S+\s+(\d{3})/', (string) ( $headers[0] ?? '' ), $match ) ) {
			throw new RuntimeException( "The page request to {$path} got no response." );
		}
		return (int) $match[1];
	};

	$fixture_signal = trailingslashit( get_temp_dir() ) . 'e2e-2059-' . wp_generate_password( 12, false );
	$fixture_ready  = $fixture_signal . '.ready';
	$fixture_free   = $fixture_signal . '.release';
	$fixture_holder = null;
	$out            = array(
		'ok'    => false,
		'stage' => 'reset',
	);
	try {
		$fixture_reset( 'pending' );

		$out['stage']   = 'acquire';
		$fixture_holder = $fixture_spawn( array( 'hold-lock', $fixture_ready, $fixture_free, '90' ) );
		$fixture_wait( $fixture_holder, 30, static fn() => file_exists( $fixture_ready ) );
		if ( ! file_exists( $fixture_ready ) ) {
			throw new RuntimeException(
				$fixture_exited( $fixture_holder )
					? 'The lock holder exited before it held the migration lock.'
					: 'The lock holder did not hold the migration lock within 30 s.'
			);
		}

		$out['stage']  = 'before';
		$out['before'] = $fixture_state();
		unset( $out['before']['log'] );

		$out['stage']      = 'request';
		$fixture_path      = '/?fair_e2e_contend=' . wp_generate_password( 12, false );
		$out['response']   = $fixture_request( $fixture_path );
		$out['stage']      = 'during';
		$fixture_during    = $fixture_state();
		$out['startup']    = null;
		$out['startupUri'] = $fixture_path;
		foreach ( $fixture_during['log'] as $entry ) {
			if ( 'http' === $entry['context'] && $fixture_path === $entry['uri'] ) {
				$out['startup'] = $entry;
			}
		}
		unset( $fixture_during['log'] );
		$out['during'] = $fixture_during;
		if ( null === $out['startup'] ) {
			throw new RuntimeException( "The page request logged no startup for {$fixture_path}." );
		}
		if ( $fixture_exited( $fixture_holder ) ) {
			throw new RuntimeException( 'The lock holder exited before it was told to release the lock.' );
		}

		$out['stage'] = 'release';
		file_put_contents( $fixture_free, '1' );
		if ( ! $fixture_wait( $fixture_holder, 30 ) ) {
			throw new RuntimeException( 'The lock holder did not exit within 30 s of the release signal.' );
		}
		$out['holder']  = $fixture_finish( $fixture_holder );
		$fixture_holder = null;
		$fixture_held   = $fixture_result( $out['holder'] );
		if ( empty( $fixture_held['held'] ) ) {
			throw new RuntimeException( 'The lock holder did not report a completed hold.' );
		}

		$out['ok']    = true;
		$out['stage'] = 'done';
	} catch ( Throwable $error ) {
		$out['error'] = $error->getMessage();
	} finally {
		if ( null !== $fixture_holder ) {
			$out['holder'] = $fixture_finish( $fixture_holder );
		}
		wp_delete_file( $fixture_ready );
		wp_delete_file( $fixture_free );
	}
}

echo 'E2E_NOTIFICATION_STARTUP:' . wp_json_encode( $out ) . "\n";
