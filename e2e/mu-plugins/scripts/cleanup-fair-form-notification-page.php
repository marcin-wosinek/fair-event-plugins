<?php
/**
 * Delete an E2E-seeded Fair Form notification page and any questionnaire
 * submissions/answers the spec created against it via REST.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-fair-form-notification-page.php <pageId>
 *
 * Prints a single `E2E_FAIR_FORM_NOTIFICATION_CLEANUP:{json}` line with row counts.
 *
 * @package FairFormE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$page_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $page_id ) {
	WP_CLI::error( 'Usage: cleanup-fair-form-notification-page.php <pageId>' );
}

$answers_table     = $wpdb->prefix . 'fair_audience_questionnaire_answers';
$submissions_table = $wpdb->prefix . 'fair_audience_questionnaire_submissions';

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script.
$submission_ids = $wpdb->get_col(
	$wpdb->prepare( 'SELECT id FROM %i WHERE post_id = %d', $submissions_table, $page_id )
);

$deleted = array();

if ( $submission_ids ) {
	$placeholders = implode( ', ', array_fill( 0, count( $submission_ids ), '%d' ) );
	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $placeholders is a safe list of %d.
	$deleted['answers'] = (int) $wpdb->query(
		$wpdb->prepare(
			"DELETE FROM %i WHERE submission_id IN ({$placeholders})",
			array_merge( array( $answers_table ), $submission_ids )
		)
	);
	// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
}

$deleted['submissions'] = (int) $wpdb->query(
	$wpdb->prepare( 'DELETE FROM %i WHERE post_id = %d', $submissions_table, $page_id )
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

$deleted['page'] = wp_delete_post( $page_id, true ) ? 1 : 0;

echo 'E2E_FAIR_FORM_NOTIFICATION_CLEANUP:' . wp_json_encode( $deleted ) . "\n";
