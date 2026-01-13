<?php
/**
 * EventParticipant Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * EventParticipant model for junction table.
 */
class EventParticipant {

	/**
	 * Junction record ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Event (post) ID.
	 *
	 * @var int
	 */
	public $event_id;

	/**
	 * Participant ID.
	 *
	 * @var int
	 */
	public $participant_id;

	/**
	 * Relationship label.
	 *
	 * @var string
	 */
	public $label;

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
		$this->id             = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->event_id       = isset( $data['event_id'] ) ? (int) $data['event_id'] : 0;
		$this->participant_id = isset( $data['participant_id'] ) ? (int) $data['participant_id'] : 0;
		$this->label          = isset( $data['label'] ) ? $data['label'] : 'interested';
		$this->created_at     = isset( $data['created_at'] ) ? $data['created_at'] : '';
		$this->updated_at     = isset( $data['updated_at'] ) ? $data['updated_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_event_participants';

		if ( empty( $this->event_id ) || empty( $this->participant_id ) ) {
			return false;
		}

		// Validate label enum.
		if ( ! in_array( $this->label, array( 'interested', 'signed_up', 'collaborator' ), true ) ) {
			$this->label = 'interested';
		}

		$data = array(
			'event_id'       => $this->event_id,
			'participant_id' => $this->participant_id,
			'label'          => $this->label,
		);

		$format = array( '%d', '%d', '%s' );

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

		$table_name = $wpdb->prefix . 'fair_audience_event_participants';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
