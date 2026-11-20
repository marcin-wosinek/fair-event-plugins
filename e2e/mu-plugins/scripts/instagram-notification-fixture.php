<?php
/**
 * Fixture for the scheduled Instagram post specs (#2076).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/instagram-notification-fixture.php state
 *   wp eval-file wp-content/mu-plugins/scripts/instagram-notification-fixture.php feature <on|off>
 *   wp eval-file wp-content/mu-plugins/scripts/instagram-notification-fixture.php connect
 *   wp eval-file wp-content/mu-plugins/scripts/instagram-notification-fixture.php disconnect
 *   wp eval-file wp-content/mu-plugins/scripts/instagram-notification-fixture.php publish <configId>
 *   wp eval-file wp-content/mu-plugins/scripts/instagram-notification-fixture.php cleanup <configId>
 *
 * `state` reports the Instagram feature, whether a connection is stored, and
 * how many images wait in the uploads folder, so a spec can restore the
 * feature and leave a site's own connection alone. `feature` turns the
 * Experimental `instagram` feature on or off. `connect` stores a Unified
 * Login connection with the `e2e-ig-unified-ok` token, which
 * fair-e2e-protected-credentials.php answers for, so nothing reaches Meta.
 * `publish` runs the configuration's scheduled send for the current week and
 * its publishing steps, with HTTPS upload URLs, as WP-Cron would. `cleanup`
 * removes the configuration's runs, jobs and scheduled events.
 *
 * Run `feature on` in a request of its own: the connection is claimed while
 * the plugins load, so `connect` and `publish` run in the next request.
 *
 * Prints a single `E2E_INSTAGRAM:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\InstagramDispatcher;
use FairEvents\Notifications\InstagramSettings;
use FairEvents\Notifications\WeekSchedule;
use FairEventsExperimental\Instagram\Connection;

$fixture_step = isset( $args[0] ) ? (string) $args[0] : '';
$out          = array();
$images       = static function () {
	return count( glob( trailingslashit( wp_upload_dir( null, false )['basedir'] ) . 'fair-events-instagram/*.jpg' ) );
};

if ( 'state' === $fixture_step ) {
	$features = get_option( 'fair_events_experimental_features', array() );
	$out      = array(
		'feature'   => ! empty( $features['instagram'] ),
		'connected' => '' !== (string) get_option( 'fair_audience_instagram_access_token', '' ),
		'images'    => $images(),
	);
} elseif ( 'feature' === $fixture_step ) {
	$features              = (array) get_option( 'fair_events_experimental_features', array() );
	$features['instagram'] = 'on' === ( $args[1] ?? '' );
	update_option( 'fair_events_experimental_features', $features );
	$out = array( 'feature' => $features['instagram'] );
} elseif ( 'connect' === $fixture_step ) {
	$result = Connection::connect(
		array(
			'access_token'  => 'e2e-ig-unified-ok',
			'token_type'    => 'system_user',
			'scopes'        => array( 'instagram_basic', 'instagram_content_publish' ),
			'expires_at'    => null,
			'account_id'    => '17841400000000001',
			'username'      => 'e2e_unified_club',
			'graph_version' => 'v27.0',
		)
	);
	if ( is_wp_error( $result ) ) {
		WP_CLI::error( $result->get_error_message() );
	}
	$out = array( 'connected' => Connection::is_connected() );
} elseif ( 'disconnect' === $fixture_step ) {
	Connection::disconnect();
	$out = array( 'connected' => false );
} elseif ( 'publish' === $fixture_step ) {
	$config_id = (string) ( $args[1] ?? '' );
	// Instagram downloads the image over HTTPS; the test site serves HTTP.
	add_filter(
		'upload_dir',
		static function ( $dirs ) {
			$dirs['baseurl'] = set_url_scheme( $dirs['baseurl'], 'https' );
			return $dirs;
		}
	);
	$settings   = InstagramSettings::get( $config_id );
	$week       = WeekSchedule::target_week( InstagramDispatcher::now(), $settings['week_scope'], (int) get_option( 'start_of_week', 1 ) );
	$dispatcher = new InstagramDispatcher();
	$run        = $dispatcher->process( $config_id, $week['start'], $settings, InstagramDispatcher::now() );
	// The steps WP-Cron would run, until the job finishes.
	for ( $i = 0; $i < 5 && $dispatcher->job( $config_id, $week['start'] ); $i++ ) {
		$run = $dispatcher->step( $config_id, $week['start'] );
	}
	$out = array(
		'run'    => $run,
		'week'   => $week,
		'images' => $images(),
	);
} elseif ( 'cleanup' === $fixture_step ) {
	$config_id = (string) ( $args[1] ?? '' );
	if ( Configurations::valid_id( $config_id ) ) {
		foreach ( InstagramDispatcher::jobs( $config_id ) as $job ) {
			delete_option( Configurations::option( $config_id, 'instagram_job_' . $job['week_start'] ) );
		}
		update_option(
			InstagramDispatcher::JOBS_OPTION,
			array_values(
				array_filter(
					(array) get_option( InstagramDispatcher::JOBS_OPTION, array() ),
					static function ( $key ) use ( $config_id ) {
						return 0 !== strpos( (string) $key, $config_id . '|' );
					}
				)
			),
			false
		);
		delete_option( Configurations::option( $config_id, 'runs' ) );
		InstagramDispatcher::unschedule( $config_id );
	}
	$out = array( 'cleaned' => $config_id );
} else {
	WP_CLI::error( 'Unknown step: ' . $fixture_step );
}

echo 'E2E_INSTAGRAM:' . wp_json_encode( $out ) . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI output.
