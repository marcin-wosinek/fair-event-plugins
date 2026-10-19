<?php
/**
 * Seed a questionnaire submission with Date and Date & Time answers for the
 * Fair Form submission detail regression (#1937).
 *
 * Besides populated values, both date types get an empty answer so the
 * placeholder path is covered, and a short-text answer proves the rest of the
 * page still renders.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-fair-form-date-answers.php
 *
 * Tear down with cleanup-fair-form-notification-page.php <pageId>, which
 * removes every submission and answer of the page.
 *
 * Prints a single `E2E_FAIR_FORM_DATE_ANSWERS:{json}` line the spec parses.
 *
 * @package FairFormE2E
 */

use FairForm\Models\QuestionnaireSubmission;
use FairForm\Models\QuestionnaireAnswer;

$page_id = wp_insert_post(
	array(
		'post_type'   => 'page',
		'post_status' => 'publish',
		'post_title'  => 'E2E Fair Form Date Answers ' . gmdate( 'YmdHis' ),
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create page: ' . $page_id->get_error_message() );
}

$submission = new QuestionnaireSubmission(
	array(
		'post_id'    => $page_id,
		'title'      => 'E2E Date Answers',
		'form_id'    => 'e2e-date-answers',
		'form_title' => 'E2E Date Answers',
	)
);

if ( ! $submission->save() ) {
	WP_CLI::error( 'Failed to create questionnaire submission.' );
}

$answers = array(
	array( 'e2e_birthday', 'E2E Birthday', 'date', '2026-07-08' ),
	array( 'e2e_arrival', 'E2E Arrival', 'datetime', '2026-07-08 23:30:00' ),
	array( 'e2e_departure_day', 'E2E Departure day', 'date', '' ),
	array( 'e2e_pickup_time', 'E2E Pickup time', 'datetime', '' ),
	array( 'e2e_dietary', 'E2E Dietary needs', 'short_text', 'Vegetarian' ),
);

foreach ( $answers as $position => list( $key, $text, $question_type, $value ) ) {
	$answer = new QuestionnaireAnswer(
		array(
			'submission_id' => $submission->id,
			'question_key'  => $key,
			'question_text' => $text,
			'question_type' => $question_type,
			'answer_value'  => $value,
			'display_order' => $position,
		)
	);

	if ( ! $answer->save() ) {
		WP_CLI::error( "Failed to create questionnaire answer {$key}." );
	}
}

echo 'E2E_FAIR_FORM_DATE_ANSWERS:' . wp_json_encode(
	array(
		'pageId'       => (int) $page_id,
		'submissionId' => (int) $submission->id,
	)
) . "\n";
