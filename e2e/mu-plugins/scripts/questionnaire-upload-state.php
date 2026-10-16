<?php
/**
 * Report, and optionally delete, a Fair Form submission with a file answer.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/questionnaire-upload-state.php <formId> [cleanup]
 *
 * Looks up the submission stored for the form id, its file answer, and the
 * attachment that answer refers to. With `cleanup`, deletes the submission,
 * its answers, the attachment and the submitter's participant afterwards.
 *
 * Prints a single `E2E_STATE:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$form_id = isset( $args[0] ) ? sanitize_text_field( $args[0] ) : '';
$cleanup = isset( $args[1] ) && 'cleanup' === $args[1];

$submissions = $wpdb->prefix . 'fair_audience_questionnaire_submissions';
$answers     = $wpdb->prefix . 'fair_audience_questionnaire_answers';

// phpcs:disable WordPress.DB.DirectDatabaseQuery
$submission = $wpdb->get_row(
	$wpdb->prepare( 'SELECT id, participant_id FROM %i WHERE form_id = %s ORDER BY id DESC LIMIT 1', $submissions, $form_id )
);
$answer     = $submission ? $wpdb->get_row(
	$wpdb->prepare( 'SELECT question_type, answer_value FROM %i WHERE submission_id = %d AND question_key = %s', $answers, $submission->id, 'photo' )
) : null;

$attachment_id = $answer ? (int) $answer->answer_value : 0;
$state         = array(
	'submissionFound'  => (bool) $submission,
	'participantId'    => $submission ? (int) $submission->participant_id : 0,
	'answerType'       => $answer ? $answer->question_type : null,
	'attachmentId'     => $attachment_id,
	'attachmentExists' => $attachment_id > 0 && 'attachment' === get_post_type( $attachment_id ),
	'fileExists'       => $attachment_id > 0 && file_exists( (string) get_attached_file( $attachment_id ) ),
	'photoTableExists' => (bool) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->prefix . 'fair_audience_photo_participants' ) ),
);

if ( $cleanup && $submission ) {
	$wpdb->delete( $answers, array( 'submission_id' => $submission->id ) );
	$wpdb->delete( $submissions, array( 'id' => $submission->id ) );
	if ( $submission->participant_id ) {
		$wpdb->delete( $wpdb->prefix . 'fair_audience_participants', array( 'id' => $submission->participant_id ) );
	}
	if ( $attachment_id > 0 ) {
		wp_delete_attachment( $attachment_id, true );
	}
}
// phpcs:enable

echo 'E2E_STATE:' . wp_json_encode( $state ) . "\n";
