<?php
/**
 * Seed a questionnaire submission + answer for the fair-form admin-menu
 * mount-smoke suite (#1077).
 *
 * The Answers Overview page groups by page/event/form and would silently
 * render an empty table if the DataViews `fields` config regressed (#1076) —
 * an empty root still "mounts", so this suite needs at least one real row to
 * prove the label/count actually render, not just that a root has children.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-fair-form-answer.php
 *
 * Prints a single `E2E_FAIR_FORM_SEED:{json}` line the spec parses.
 *
 * @package FairFormE2E
 */

use FairForm\Models\QuestionnaireSubmission;
use FairForm\Models\QuestionnaireAnswer;

$post_title = 'E2E Fair Form Page ' . gmdate( 'YmdHis' );

$page_id = wp_insert_post(
	array(
		'post_type'   => 'page',
		'post_status' => 'publish',
		'post_title'  => $post_title,
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create page: ' . $page_id->get_error_message() );
}

$submission = new QuestionnaireSubmission(
	array(
		'post_id'    => $page_id,
		'title'      => 'E2E Submission',
		'form_id'    => 'e2e-form',
		'form_title' => 'E2E Form',
	)
);

if ( ! $submission->save() ) {
	WP_CLI::error( 'Failed to create questionnaire submission.' );
}

$answer = new QuestionnaireAnswer(
	array(
		'submission_id' => $submission->id,
		'question_key'  => 'e2e_question',
		'question_text' => 'How did you hear about us?',
		'question_type' => 'short_text',
		'answer_value'  => 'E2E Answer Value',
		'display_order' => 0,
	)
);

if ( ! $answer->save() ) {
	WP_CLI::error( 'Failed to create questionnaire answer.' );
}

echo 'E2E_FAIR_FORM_SEED:' . wp_json_encode(
	array(
		'postId'       => (int) $page_id,
		'postTitle'    => $post_title,
		'submissionId' => (int) $submission->id,
		'answerId'     => (int) $answer->id,
	)
) . "\n";
