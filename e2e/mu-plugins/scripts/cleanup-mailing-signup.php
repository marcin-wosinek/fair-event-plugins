<?php
/**
 * Delete an E2E-seeded mailing-signup page and the pending participant it created.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-mailing-signup.php <pageId> <email>
 *
 * Removes the participant's confirmation tokens and signup rate-limit
 * transient too, so repeated local runs start from a clean slate.
 *
 * Prints a single `E2E_MAILING_SIGNUP_CLEANUP:{json}` line with row counts.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$page_id = isset( $args[0] ) ? (int) $args[0] : 0;
$email   = isset( $args[1] ) ? sanitize_email( $args[1] ) : '';
if ( ! $page_id || ! $email ) {
	WP_CLI::error( 'Usage: cleanup-mailing-signup.php <pageId> <email>' );
}

$participants_table = $wpdb->prefix . 'fair_audience_participants';
$tokens_table       = $wpdb->prefix . 'fair_audience_email_confirmation_tokens';

$deleted = array(
	'tokens'       => 0,
	'participants' => 0,
);

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script, no cache to honour.
$participant_ids = $wpdb->get_col(
	$wpdb->prepare( 'SELECT id FROM %i WHERE email = %s', $participants_table, $email )
);

foreach ( $participant_ids as $participant_id ) {
	$deleted['tokens']       += (int) $wpdb->query(
		$wpdb->prepare( 'DELETE FROM %i WHERE participant_id = %d', $tokens_table, $participant_id )
	);
	$deleted['participants'] += (int) $wpdb->query(
		$wpdb->prepare( 'DELETE FROM %i WHERE id = %d', $participants_table, $participant_id )
	);
}
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

delete_transient( 'fair_audience_signup_' . md5( $email ) );

$deleted['page'] = wp_delete_post( $page_id, true ) ? 1 : 0;

echo 'E2E_MAILING_SIGNUP_CLEANUP:' . wp_json_encode( $deleted ) . "\n";
