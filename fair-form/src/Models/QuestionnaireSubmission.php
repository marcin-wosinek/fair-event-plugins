<?php
/**
 * Questionnaire Submission Model
 *
 * @package FairForm
 */

namespace FairForm\Models;

defined( 'WPINC' ) || die;

/**
 * Questionnaire submission model.
 */
class QuestionnaireSubmission {

	/**
	 * Submission ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Participant ID.
	 *
	 * @var int
	 */
	public $participant_id;

	/**
	 * Event date ID (optional).
	 *
	 * @var int|null
	 */
	public $event_date_id;

	/**
	 * Post ID (optional).
	 *
	 * @var int|null
	 */
	public $post_id;

	/**
	 * Questionnaire title.
	 *
	 * @var string
	 */
	public $title;

	/**
	 * Stable form identity UUID (from block attribute).
	 *
	 * @var string|null
	 */
	public $form_id;

	/**
	 * Human-readable form label (from block attribute).
	 *
	 * @var string|null
	 */
	public $form_title;

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
		$this->id             = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->participant_id = isset( $data['participant_id'] ) ? (int) $data['participant_id'] : 0;
		$this->event_date_id  = isset( $data['event_date_id'] ) ? (int) $data['event_date_id'] : null;
		$this->post_id        = isset( $data['post_id'] ) ? (int) $data['post_id'] : null;
		$this->title          = isset( $data['title'] ) ? $data['title'] : '';
		$this->form_id        = isset( $data['form_id'] ) ? $data['form_id'] : null;
		$this->form_title     = isset( $data['form_title'] ) ? $data['form_title'] : null;
		$this->created_at     = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_questionnaire_submissions';

		// Validate required fields.
		if ( empty( $this->participant_id ) ) {
			return false;
		}

		$data = array(
			'participant_id' => $this->participant_id,
			'event_date_id'  => $this->event_date_id,
			'post_id'        => $this->post_id,
			'title'          => $this->title,
			'form_id'        => $this->form_id,
			'form_title'     => $this->form_title,
		);

		$format = array( '%d', '%d', '%d', '%s', '%s', '%s' );

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

		return false !== $result;
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

		$table_name = $wpdb->prefix . 'fair_audience_questionnaire_submissions';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
