<?php
/**
 * Report the questionnaire submission stored for a seeded Fair Form page.
 *
 * The public submit endpoint answers with `{success, message}` only — by
 * design, so an anonymous submitter never learns an internal row id — so the
 * spec cannot read the submission id off the response. This script resolves it
 * server-side instead, keeping #619 test-only.
 *
 * Returns the most recent submission for the page, so a spec that submits more
 * than once still gets the one it just created.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/fair-form-submission-state.php <postId>
 *
 * Prints a single `E2E_FAIR_FORM_SUBMISSION:{json}` line.
 *
 * @package FairFormE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$page_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $page_id ) {
	WP_CLI::error( 'Usage: fair-form-submission-state.php <postId>' );
}

$submissions_table = $wpdb->prefix . 'fair_audience_questionnaire_submissions';
$answers_table     = $wpdb->prefix . 'fair_audience_questionnaire_answers';

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off state dump for the spec, no cache to honour.
$submission = $wpdb->get_row(
	$wpdb->prepare(
		'SELECT * FROM %i WHERE post_id = %d ORDER BY id DESC LIMIT 1',
		$submissions_table,
		$page_id
	)
);

if ( ! $submission ) {
	echo 'E2E_FAIR_FORM_SUBMISSION:' . wp_json_encode( array( 'found' => false ) ) . "\n";
	return;
}

$answer_count = (int) $wpdb->get_var(
	$wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE submission_id = %d', $answers_table, $submission->id )
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

echo 'E2E_FAIR_FORM_SUBMISSION:' . wp_json_encode(
	array(
		'found'         => true,
		'submissionId'  => (int) $submission->id,
		'participantId' => $submission->participant_id ? (int) $submission->participant_id : null,
		'title'         => (string) $submission->title,
		'formId'        => (string) $submission->form_id,
		'formTitle'     => (string) $submission->form_title,
		'answerCount'   => $answer_count,
	)
) . "\n";
