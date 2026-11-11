<?php
/**
 * Fixture for the audience CSV migration (#2218).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/audience-migration-fixture.php member <email> <name> <surname> <profile> <optOut> <status>
 *   wp eval-file wp-content/mu-plugins/scripts/audience-migration-fixture.php sweep <email>
 *   wp eval-file wp-content/mu-plugins/scripts/audience-migration-fixture.php cleanup <emails>
 *
 * `member` stores a participant as given, without signup side effects.
 * `sweep` backdates the participant's last update past the pending
 * subscription timeout, runs the timeout sweep as WP-Cron would, and reports
 * the participant's mailing choice and status afterwards. `cleanup` takes a
 * comma-separated list and removes those participants with their tokens,
 * feeds, categories and consent log entries.
 *
 * Prints a single `E2E_AUDIENCE_MIGRATION:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$fixture_action = $args[0] ?? '';
$fixture_out    = array();
$fixture_table  = $wpdb->prefix . 'fair_audience_participants';

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test fixture, no cache to honour.
if ( 'member' === $fixture_action ) {
	$fixture_member = new \FairAudience\Models\Participant(
		array(
			'name'                   => $args[2] ?? 'Ana',
			'surname'                => $args[3] ?? 'Ruiz',
			'email'                  => sanitize_email( $args[1] ?? '' ),
			'email_profile'          => $args[4] ?? 'marketing',
			'weekly_summary_opt_out' => (int) ( $args[5] ?? 0 ),
			'status'                 => $args[6] ?? 'confirmed',
		)
	);
	if ( ! $fixture_member->save() ) {
		WP_CLI::error( 'Participant not saved.' );
	}
	$fixture_out = array( 'participant_id' => (int) $fixture_member->id );
} elseif ( 'sweep' === $fixture_action ) {
	$fixture_email = sanitize_email( $args[1] ?? '' );
	$wpdb->update(
		$fixture_table,
		array( 'updated_at' => gmdate( 'Y-m-d H:i:s', time() - 8 * DAY_IN_SECONDS ) ),
		array( 'email' => $fixture_email ),
		array( '%s' ),
		array( '%s' )
	);
	\FairAudience\Hooks\PendingSubscriptionTimeoutHooks::run();
	$fixture_out = $wpdb->get_row(
		$wpdb->prepare( 'SELECT email_profile, status FROM %i WHERE email = %s', $fixture_table, $fixture_email ),
		ARRAY_A
	);
} elseif ( 'cleanup' === $fixture_action ) {
	foreach ( array_filter( explode( ',', (string) ( $args[1] ?? '' ) ) ) as $fixture_email ) {
		$fixture_id = (int) $wpdb->get_var(
			$wpdb->prepare( 'SELECT id FROM %i WHERE email = %s', $fixture_table, $fixture_email )
		);
		if ( ! $fixture_id ) {
			continue;
		}
		foreach ( array( 'fair_audience_email_confirmation_tokens', 'fair_audience_participant_feeds', 'fair_audience_participant_categories', 'fair_audience_email_consent_log' ) as $fixture_related ) {
			$wpdb->delete( $wpdb->prefix . $fixture_related, array( 'participant_id' => $fixture_id ), array( '%d' ) );
		}
		$wpdb->delete( $fixture_table, array( 'id' => $fixture_id ), array( '%d' ) );
	}
	$fixture_out = array( 'ok' => true );
}
// phpcs:enable

echo 'E2E_AUDIENCE_MIGRATION:' . wp_json_encode( $fixture_out ) . "\n";
