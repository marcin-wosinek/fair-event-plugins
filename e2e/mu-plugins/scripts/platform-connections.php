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
 *                  relative to the database clock. Prints the insert IDs.
 *   rows           {}  Every row of both tables, by ID.
 *   site-filter    {type, siteId}  The repository listing for one site.
 *   token-refresh  {type, siteId}  Record a token refresh for one site;
 *                  prints the repository's return value.
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
				unset( $row['daysAgo'] );
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

	case 'token-refresh':
		$result = array(
			'updated' => $fixture_repository( (string) $data['type'] )->update_token_refresh(
				(string) $data['siteId']
			),
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
