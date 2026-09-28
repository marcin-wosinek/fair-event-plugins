<?php
/**
 * Ticket Answers
 *
 * @package FairForm
 */

namespace FairForm\Services;

use FairForm\Database\QuestionnaireAnswerRepository;
use FairForm\Database\QuestionnaireSubmissionRepository;
use FairForm\Models\QuestionnaireSubmission;

defined( 'WPINC' ) || die;

/**
 * Read side of the submission-to-ticket link, for the fair-events and
 * fair-audience admin views that show a ticket's answers. Those plugins call
 * it behind a class_exists() guard, so its public shape is additive-only.
 */
class TicketAnswers {

	/**
	 * Answers attached to each of the given tickets.
	 *
	 * @param int[] $ticket_ids Ticket IDs.
	 * @return array<int, array> Keyed by ticket ID; each entry has
	 *                           submission_id, ticket_link, needs_review
	 *                           and answers (see format_answer()).
	 *                           Tickets without answers are left out.
	 */
	public static function for_tickets( array $ticket_ids ) {
		$answer_repo = new QuestionnaireAnswerRepository();

		$by_ticket = array();
		foreach ( ( new QuestionnaireSubmissionRepository() )->get_by_ticket_ids( $ticket_ids ) as $submission ) {
			// One submission per ticket; the oldest wins should a duplicate exist.
			if ( isset( $by_ticket[ $submission->ticket_id ] ) ) {
				continue;
			}
			$by_ticket[ $submission->ticket_id ] = self::describe( $submission, $answer_repo );
		}

		return $by_ticket;
	}

	/**
	 * Signup answers of each participant on an event date that are not
	 * attached to any ticket: submissions collected without a ticket, or
	 * whose ticket was removed or never found. The newest submission of each
	 * participant wins. Standalone Fair Form submissions are left out.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array<int, array> Keyed by participant ID, shaped as for_tickets() entries.
	 */
	public static function participant_scope_for_event_date( $event_date_id ) {
		$answer_repo = new QuestionnaireAnswerRepository();
		$submissions = ( new QuestionnaireSubmissionRepository() )->get_by_filters(
			array( 'event_date_id' => (int) $event_date_id )
		);

		$by_participant = array();
		foreach ( $submissions as $submission ) {
			if ( ! empty( $submission->form_id ) || null !== $submission->ticket_id || ! $submission->participant_id ) {
				continue;
			}
			// Ordered newest first.
			if ( isset( $by_participant[ $submission->participant_id ] ) ) {
				continue;
			}
			$by_participant[ $submission->participant_id ] = self::describe( $submission, $answer_repo );
		}

		return $by_participant;
	}

	/**
	 * One answer shaped for a REST response: question_key, question_text,
	 * question_type and answer_value, plus file_url and is_image for an
	 * uploaded file.
	 *
	 * @param \FairForm\Models\QuestionnaireAnswer $answer Answer model.
	 * @return array
	 */
	public static function format_answer( $answer ) {
		$answer_item = array(
			'question_key'  => $answer->question_key,
			'question_text' => $answer->question_text,
			'question_type' => $answer->question_type,
			'answer_value'  => $answer->answer_value,
		);

		if ( 'file_upload' === $answer->question_type && is_numeric( $answer->answer_value ) ) {
			$attachment_id  = (int) $answer->answer_value;
			$attachment_url = wp_get_attachment_url( $attachment_id );
			if ( $attachment_url ) {
				$answer_item['file_url'] = $attachment_url;
				$mime                    = get_post_mime_type( $attachment_id );
				$answer_item['is_image'] = $mime && 0 === strpos( $mime, 'image/' );
			}
		}

		return $answer_item;
	}

	/**
	 * Describe one submission with its answers.
	 *
	 * @param QuestionnaireSubmission       $submission  Submission.
	 * @param QuestionnaireAnswerRepository $answer_repo Answer repository.
	 * @return array
	 */
	private static function describe( QuestionnaireSubmission $submission, QuestionnaireAnswerRepository $answer_repo ) {
		return array(
			'submission_id' => (int) $submission->id,
			'ticket_link'   => $submission->ticket_link,
			'needs_review'  => $submission->needs_review(),
			'answers'       => array_map( array( self::class, 'format_answer' ), $answer_repo->get_by_submission( $submission->id ) ),
		);
	}
}
