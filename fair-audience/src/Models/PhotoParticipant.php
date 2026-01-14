<?php
/**
 * PhotoParticipant Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * PhotoParticipant model for photo-participant relationships.
 *
 * Supports both "author" (who took the photo) and "tagged" (who appears in the photo) roles.
 */
class PhotoParticipant {

	/**
	 * Record ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Attachment (photo) ID.
	 *
	 * @var int
	 */
	public $attachment_id;

	/**
	 * Participant ID.
	 *
	 * @var int
	 */
	public $participant_id;

	/**
	 * Role type: 'author' or 'tagged'.
	 *
	 * @var string
	 */
	public $role;

	/**
	 * Created timestamp.
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Valid role values.
	 *
	 * @var array
	 */
	const VALID_ROLES = array( 'author', 'tagged' );

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
		$this->attachment_id  = isset( $data['attachment_id'] ) ? (int) $data['attachment_id'] : 0;
		$this->participant_id = isset( $data['participant_id'] ) ? (int) $data['participant_id'] : 0;
		$this->role           = isset( $data['role'] ) ? $data['role'] : 'author';
		$this->created_at     = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_photo_participants';

		if ( empty( $this->attachment_id ) || empty( $this->participant_id ) ) {
			return false;
		}

		// Validate role enum.
		if ( ! in_array( $this->role, self::VALID_ROLES, true ) ) {
			$this->role = 'author';
		}

		$data = array(
			'attachment_id'  => $this->attachment_id,
			'participant_id' => $this->participant_id,
			'role'           => $this->role,
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

		$table_name = $wpdb->prefix . 'fair_audience_photo_participants';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
