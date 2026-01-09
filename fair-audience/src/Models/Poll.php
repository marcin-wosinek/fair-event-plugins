<?php
/**
 * Poll Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Poll model.
 */
class Poll {

	/**
	 * Poll ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Event ID.
	 *
	 * @var int
	 */
	public $event_id;

	/**
	 * Poll title (internal reference).
	 *
	 * @var string
	 */
	public $title;

	/**
	 * Poll question (shown to participants).
	 *
	 * @var string
	 */
	public $question;

	/**
	 * Poll status.
	 *
	 * @var string
	 */
	public $status;

	/**
	 * Created timestamp.
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Updated timestamp.
	 *
	 * @var string
	 */
	public $updated_at;

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
		$this->id         = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->event_id   = isset( $data['event_id'] ) ? (int) $data['event_id'] : 0;
		$this->title      = isset( $data['title'] ) ? sanitize_text_field( $data['title'] ) : '';
		$this->question   = isset( $data['question'] ) ? sanitize_textarea_field( $data['question'] ) : '';
		$this->status     = isset( $data['status'] ) ? $data['status'] : 'draft';
		$this->created_at = isset( $data['created_at'] ) ? $data['created_at'] : '';
		$this->updated_at = isset( $data['updated_at'] ) ? $data['updated_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_polls';

		// Validate required fields.
		if ( empty( $this->event_id ) || empty( $this->title ) || empty( $this->question ) ) {
			return false;
		}

		// Validate status enum.
		if ( ! in_array( $this->status, array( 'draft', 'active', 'closed' ), true ) ) {
			$this->status = 'draft';
		}

		$data = array(
			'event_id' => $this->event_id,
			'title'    => $this->title,
			'question' => $this->question,
			'status'   => $this->status,
		);

		$format = array( '%d', '%s', '%s', '%s' );

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

		$table_name = $wpdb->prefix . 'fair_audience_polls';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
