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
	 * Recorded by the signup that collected it, for this ticket.
	 */
	const LINK_DIRECT = 'direct';

	/**
	 * Attached to a ticket afterwards by SubmissionTicketBackfill, because
	 * the submission predates ticket links. Needs review.
	 */
	const LINK_INFERRED = 'inferred';

	/**
	 * Predates ticket links and no ticket matched it; kept at participant
	 * scope. Needs review.
	 */
	const LINK_UNRESOLVED = 'unresolved';

	/**
	 * Its ticket was removed (quantity reduced or signup deleted); the
	 * answers are kept at participant scope. Needs review.
	 */
	const LINK_TICKET_REMOVED = 'ticket_removed';

	/**
	 * Links an administrator should check before relying on them.
	 *
	 * @var string[]
	 */
	const REVIEW_LINKS = array( self::LINK_INFERRED, self::LINK_UNRESOLVED, self::LINK_TICKET_REMOVED );

	/**
	 * Submission ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Participant ID (nullable — submissions without a linked participant are allowed).
	 *
	 * @var int|null
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
	 * Ticket the submission was collected for (fair-events ticket unit),
	 * or null when it has none.
	 *
	 * @var int|null
	 */
	public $ticket_id;

	/**
	 * How the submission is linked to a ticket (a LINK_* value), or null
	 * for a submission with no signup context.
	 *
	 * @var string|null
	 */
	public $ticket_link;

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
		$this->id = isset( $data['id'] ) ? (int) $data['id'] : null;

		// Participant ID is nullable: null means no linked participant.
		if ( array_key_exists( 'participant_id', $data ) ) {
			$this->participant_id = null !== $data['participant_id'] ? (int) $data['participant_id'] : null;
		} else {
			$this->participant_id = null;
		}

		$this->event_date_id = isset( $data['event_date_id'] ) ? (int) $data['event_date_id'] : null;
		$this->post_id       = isset( $data['post_id'] ) ? (int) $data['post_id'] : null;
		$this->title         = isset( $data['title'] ) ? $data['title'] : '';
		$this->form_id       = isset( $data['form_id'] ) ? $data['form_id'] : null;
		$this->form_title    = isset( $data['form_title'] ) ? $data['form_title'] : null;
		$this->ticket_id     = isset( $data['ticket_id'] ) ? (int) $data['ticket_id'] : null;
		$this->ticket_link   = isset( $data['ticket_link'] ) ? (string) $data['ticket_link'] : null;
		$this->created_at    = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Whether an administrator should check how this submission is linked
	 * to its ticket.
	 *
	 * @return bool
	 */
	public function needs_review() {
		return in_array( $this->ticket_link, self::REVIEW_LINKS, true );
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_questionnaire_submissions';

		// Build data array, omitting participant_id when null so the DB
		// stores NULL (the column default after the 0.2.0 migration).
		$data   = array( 'title' => $this->title );
		$format = array( '%s' );

		if ( null !== $this->participant_id ) {
			$data   = array_merge( array( 'participant_id' => (int) $this->participant_id ), $data );
			$format = array_merge( array( '%d' ), $format );
		}

		if ( null !== $this->event_date_id ) {
			$data['event_date_id'] = (int) $this->event_date_id;
			$format[]              = '%d';
		}

		if ( null !== $this->post_id ) {
			$data['post_id'] = (int) $this->post_id;
			$format[]        = '%d';
		}

		if ( null !== $this->form_id ) {
			$data['form_id'] = $this->form_id;
			$format[]        = '%s';
		}

		if ( null !== $this->form_title ) {
			$data['form_title'] = $this->form_title;
			$format[]           = '%s';
		}

		if ( null !== $this->ticket_id ) {
			$data['ticket_id'] = (int) $this->ticket_id;
			$format[]          = '%d';
		}

		if ( null !== $this->ticket_link ) {
			$data['ticket_link'] = $this->ticket_link;
			$format[]            = '%s';
		}

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
