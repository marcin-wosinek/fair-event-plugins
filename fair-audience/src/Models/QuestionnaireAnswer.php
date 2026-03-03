<?php
/**
 * Questionnaire Answer Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Questionnaire answer model.
 */
class QuestionnaireAnswer {

	/**
	 * Valid question types.
	 *
	 * @var array
	 */
	const VALID_QUESTION_TYPES = array(
		'radio',
		'checkbox',
		'short_text',
		'long_text',
		'select',
		'number',
		'date',
	);

	/**
	 * Answer ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Submission ID.
	 *
	 * @var int
	 */
	public $submission_id;

	/**
	 * Question key (machine-readable slug).
	 *
	 * @var string
	 */
	public $question_key;

	/**
	 * Question text as shown to participant.
	 *
	 * @var string
	 */
	public $question_text;

	/**
	 * Question type.
	 *
	 * @var string
	 */
	public $question_type;

	/**
	 * Answer value.
	 *
	 * @var string
	 */
	public $answer_value;

	/**
	 * Display order within submission.
	 *
	 * @var int
	 */
	public $display_order;

	/**
	 * Created timestamp.
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Constructor.
	 *
	 * @param array $data Optional data to populate.
	 */
	public function __construct( $data = array() ) {
		if ( ! empty( $data ) ) {
			$this->populate( $data );
		}
	}

	/**
	 * Populate from data array.
	 *
	 * @param array $data Data array.
	 */
	public function populate( $data ) {
		$this->id            = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->submission_id = isset( $data['submission_id'] ) ? (int) $data['submission_id'] : 0;
		$this->question_key  = isset( $data['question_key'] ) ? $data['question_key'] : '';
		$this->question_text = isset( $data['question_text'] ) ? $data['question_text'] : '';
		$this->question_type = isset( $data['question_type'] ) ? $data['question_type'] : 'short_text';
		$this->answer_value  = isset( $data['answer_value'] ) ? $data['answer_value'] : '';
		$this->display_order = isset( $data['display_order'] ) ? (int) $data['display_order'] : 0;
		$this->created_at    = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_questionnaire_answers';

		// Validate required fields.
		if ( empty( $this->submission_id ) || empty( $this->question_text ) ) {
			return false;
		}

		// Validate question type.
		if ( ! in_array( $this->question_type, self::VALID_QUESTION_TYPES, true ) ) {
			return false;
		}

		$data = array(
			'submission_id' => $this->submission_id,
			'question_key'  => $this->question_key,
			'question_text' => $this->question_text,
			'question_type' => $this->question_type,
			'answer_value'  => $this->answer_value,
			'display_order' => $this->display_order,
		);

		$format = array( '%d', '%s', '%s', '%s', '%s', '%d' );

		if ( $this->id ) {
			// Update existing.
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $this->id ),
				$format,
				array( '%d' )
			);
		} else {
			// Insert new.
			$result = $wpdb->insert( $table_name, $data, $format );
			if ( $result ) {
				$this->id = $wpdb->insert_id;
			}
		}

		return $result !== false;
	}

	/**
	 * Delete from database.
	 *
	 * @return bool Success.
	 */
	public function delete() {
		global $wpdb;

		if ( ! $this->id ) {
			return false;
		}

		$table_name = $wpdb->prefix . 'fair_audience_questionnaire_answers';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
