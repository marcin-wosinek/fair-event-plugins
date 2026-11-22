<?php
/**
 * Fair Platform connection logs for the connection administration API
 * coverage (#2230).
 *
 * Usage: wp eval-file .../platform-connections.php <action> <json>
 *
 * Actions:
 *   seed           {ordinary: [row], instagram: [row]}  Empty both
 *                  connection tables, then log each row through its
 *                  repository. A row's `daysAgo` sets `connected_at`
 *                  relative to the database clock; an ordinary row's
 *                  `refreshToken` binds it as profile completion would, and
 *                  `refreshedDaysAgo` sets `last_token_refresh` (negative is
 *                  in the future). Prints the insert IDs.
 *   rows           {}  Every row of both tables, by ID.
 *   site-filter    {type, siteId}  The repository listing for one site.
 *   fingerprint    {token}  The fingerprint the platform stores for a
 *                  refresh token.
 *   profile-session {siteId, siteName, siteUrl, refreshToken}  Store a
 *                  Mollie profile selection session as the OAuth callback
 *                  would; prints its session token and anonymous nonce.
 *   clear          {}  Empty both connection tables.
 *
 * `type` is `ordinary` or `instagram`. The tables hold only OAuth proxy
 * logs, which nothing else in the test site writes, so emptying them is
 * safe. Prints one `E2E_PLATFORM_CONNECTIONS:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */

defined( 'ABSPATH' ) || exit;

use FairPlatform\Database\ConnectionRepository;
use FairPlatform\Database\InstagramConnectionRepository;
use FairPlatform\OAuth\MollieOAuth;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$fixture_tables = array(
	'ordinary'  => $wpdb->prefix . 'fair_platform_connections',
	'instagram' => $wpdb->prefix . 'fair_platform_instagram_connections',
);

$fixture_repository = static function ( $type ) {
	if ( 'ordinary' === $type ) {
		return new ConnectionRepository();
	}
	if ( 'instagram' === $type ) {
		return new InstagramConnectionRepository();
	}
	WP_CLI::error( 'Unknown connection type: ' . $type );
};

$fixture_clear = static function () use ( $wpdb, $fixture_tables ) {
	foreach ( $fixture_tables as $table ) {
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i', $table ) );
	}
};

$result = array();

switch ( $fixture_action ) {
	case 'seed':
		$fixture_clear();
		$now = (string) $wpdb->get_var( 'SELECT NOW()' );
		foreach ( array_keys( $fixture_tables ) as $fixture_type ) {
			$result[ $fixture_type ] = array();
			$repository              = $fixture_repository( $fixture_type );
			foreach ( $data[ $fixture_type ] ?? array() as $row ) {
				$days = (int) ( $row['daysAgo'] ?? 0 );
				if ( isset( $row['refreshToken'] ) ) {
					$row['refresh_token_fingerprint'] = MollieOAuth::refresh_token_fingerprint( (string) $row['refreshToken'], wp_salt( 'auth' ) );
				}
				if ( isset( $row['refreshedDaysAgo'] ) ) {
					$row['last_token_refresh'] = gmdate(
						'Y-m-d H:i:s',
						strtotime( $now . ' UTC' ) - (int) $row['refreshedDaysAgo'] * DAY_IN_SECONDS
					);
				}
				unset( $row['daysAgo'], $row['refreshToken'], $row['refreshedDaysAgo'] );
				$row['connected_at'] = gmdate(
					'Y-m-d H:i:s',
					strtotime( $now . ' UTC' ) - $days * DAY_IN_SECONDS
				);
				$fixture_id          = $repository->log_connection( $row );
				if ( ! $fixture_id ) {
					WP_CLI::error( 'Could not log a ' . $fixture_type . ' connection: ' . $wpdb->last_error );
				}
				$result[ $fixture_type ][] = (int) $fixture_id;
			}
		}
		break;

	case 'rows':
		foreach ( $fixture_tables as $fixture_type => $table ) {
			$result[ $fixture_type ] = $wpdb->get_results(
				$wpdb->prepare( 'SELECT * FROM %i ORDER BY id', $table ),
				ARRAY_A
			);
		}
		break;

	case 'site-filter':
		$result = $fixture_repository( (string) $data['type'] )->get_connections(
			array( 'site_id' => (string) $data['siteId'] )
		);
		break;

	case 'fingerprint':
		$result = array(
			'fingerprint' => MollieOAuth::refresh_token_fingerprint( (string) $data['token'], wp_salt( 'auth' ) ),
		);
		break;

	case 'profile-session':
		$session_token = bin2hex( random_bytes( 32 ) );
		set_transient(
			"mollie_profile_selection_{$session_token}",
			array(
				'access_token'      => 'access_e2e_platform_initial',
				'refresh_token'     => (string) $data['refreshToken'],
				'expires_in'        => 3600,
				'scope'             => 'payments.read',
				'organization_id'   => 'org_e2e_refresh',
				'organization_name' => 'E2E Organization',
				'testmode'          => 1,
				'site_data'         => array(
					'site_id'      => (string) $data['siteId'],
					'site_name'    => (string) ( $data['siteName'] ?? '' ),
					'site_url'     => (string) ( $data['siteUrl'] ?? '' ),
					'return_url'   => 'https://client.example.test/wp-admin/admin.php?page=fair-payments-connector-settings',
					'client_state' => 'client-state-e2e',
				),
				'timestamp'         => time(),
			),
			600
		);
		// WP-CLI runs as no user, like the anonymous profile selection POST.
		$result = array(
			'session_token' => $session_token,
			'nonce'         => wp_create_nonce( 'profile_selection_' . $session_token ),
		);
		break;

	case 'clear':
		$fixture_clear();
		$result = array( 'cleared' => true );
		break;

	default:
		WP_CLI::error( 'Unknown action: ' . $fixture_action );
}

WP_CLI::line( 'E2E_PLATFORM_CONNECTIONS:' . wp_json_encode( $result ) );
