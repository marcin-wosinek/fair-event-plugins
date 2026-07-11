<?php
/**
 * Tear down E2E-seeded data for the fair-form admin-menu mount-smoke suite (#1077).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-fair-form-answer.php \
 *     <postId> <submissionId> <answerId>
 *
 * Prints a single `E2E_FAIR_FORM_CLEANUP:{json}` line with row counts.
 *
 * @package FairFormE2E
 */

global $wpdb;

$page_id       = isset( $args[0] ) ? (int) $args[0] : 0;
$submission_id = isset( $args[1] ) ? (int) $args[1] : 0;
$answer_id     = isset( $args[2] ) ? (int) $args[2] : 0;

if ( ! $page_id || ! $submission_id || ! $answer_id ) {
	WP_CLI::error( 'Usage: cleanup-fair-form-answer.php <postId> <submissionId> <answerId>' );
}

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script.

$answers_table     = $wpdb->prefix . 'fair_audience_questionnaire_answers';
$submissions_table = $wpdb->prefix . 'fair_audience_questionnaire_submissions';

$deleted                = array();
$deleted['answers']     = (int) $wpdb->delete( $answers_table, array( 'id' => $answer_id ), array( '%d' ) );
$deleted['submissions'] = (int) $wpdb->delete( $submissions_table, array( 'id' => $submission_id ), array( '%d' ) );
$deleted['post']        = wp_delete_post( $page_id, true ) ? 1 : 0;

// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

echo 'E2E_FAIR_FORM_CLEANUP:' . wp_json_encode( $deleted ) . "\n";
