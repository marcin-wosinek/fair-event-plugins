<?php
/**
 * Questionnaire Answer Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\QuestionnaireAnswer;

defined( 'WPINC' ) || die;

/**
 * Repository for questionnaire answer data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class QuestionnaireAnswerRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_questionnaire_answers';
	}

	/**
	 * Get answers for a submission.
	 *
	 * @param int $submission_id Submission ID.
	 * @return QuestionnaireAnswer[] Array of answers.
	 */
	public function get_by_submission( $submission_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE submission_id = %d ORDER BY display_order ASC',
				$table_name,
				$submission_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new QuestionnaireAnswer( $row );
			},
			$results
		);
	}

	/**
	 * Save answers for a submission (atomic operation).
	 * Deletes existing answers and inserts new ones.
	 *
	 * @param int   $submission_id Submission ID.
	 * @param array $answers       Array of answer data arrays.
	 * @return bool Success.
	 */
	public function save_answers( $submission_id, $answers ) {
		global $wpdb;

		// Start transaction.
		$wpdb->query( 'START TRANSACTION' );

		// Delete existing answers.
		$this->delete_by_submission( $submission_id );

		// Insert new answers.
		foreach ( $answers as $answer_data ) {
			$answer = new QuestionnaireAnswer();
			$answer->populate(
				array_merge(
					$answer_data,
					array( 'submission_id' => $submission_id )
				)
			);

			if ( ! $answer->save() ) {
				$wpdb->query( 'ROLLBACK' );
				return false;
			}
		}

		// Commit transaction.
		$wpdb->query( 'COMMIT' );

		return true;
	}

	/**
	 * Delete all answers for a submission.
	 *
	 * @param int $submission_id Submission ID.
	 * @return bool Success.
	 */
	public function delete_by_submission( $submission_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array( 'submission_id' => $submission_id ),
			array( '%d' )
		) !== false;
	}

	/**
	 * Get answer counts grouped by question key and answer value.
	 *
	 * @param string   $question_key   Question key to aggregate.
	 * @param int|null $event_date_id  Optional event date ID filter.
	 * @param int|null $post_id        Optional post ID filter.
	 * @return array Array of ['answer_value' => count, ...].
	 */
	public function get_answer_counts_by_key( $question_key, $event_date_id = null, $post_id = null ) {
		global $wpdb;

		$answers_table     = $this->get_table_name();
		$submissions_table = $wpdb->prefix . 'fair_audience_questionnaire_submissions';

		$where  = array( 'a.question_key = %s' );
		$values = array( $answers_table, $submissions_table, $question_key );

		if ( null !== $event_date_id ) {
			$where[]  = 's.event_date_id = %d';
			$values[] = $event_date_id;
		}

		if ( null !== $post_id ) {
			$where[]  = 's.post_id = %d';
			$values[] = $post_id;
		}

		$sql = 'SELECT a.answer_value, COUNT(*) as count FROM %i a'
			. ' INNER JOIN %i s ON a.submission_id = s.id'
			. ' WHERE ' . implode( ' AND ', $where )
			. ' GROUP BY a.answer_value';

		$results = $wpdb->get_results(
			$wpdb->prepare( $sql, ...$values ),
			ARRAY_A
		);

		$counts = array();
		foreach ( $results as $row ) {
			$counts[ $row['answer_value'] ] = (int) $row['count'];
		}

		return $counts;
	}
}
