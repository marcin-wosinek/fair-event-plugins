<?php
/**
 * PhotoLike model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * PhotoLike model class for photo-user/participant like relationships.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PhotoLike {

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
	 * WordPress user ID (null if participant-based like).
	 *
	 * @var int|null
	 */
	public $user_id;

	/**
	 * Participant ID from fair-audience (null if user-based like).
	 *
	 * @var int|null
	 */
	public $participant_id;

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
	 * Populate from data array or object.
	 *
	 * @param array|object $data Data array or object.
	 */
	public function populate( $data ) {
		$data = (array) $data;

		$this->id             = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->attachment_id  = isset( $data['attachment_id'] ) ? (int) $data['attachment_id'] : 0;
		$this->user_id        = isset( $data['user_id'] ) && $data['user_id'] ? (int) $data['user_id'] : null;
		$this->participant_id = isset( $data['participant_id'] ) && $data['participant_id'] ? (int) $data['participant_id'] : null;
		$this->created_at     = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_events_photo_likes';

		// Must have attachment_id and either user_id or participant_id.
		if ( empty( $this->attachment_id ) ) {
			return false;
		}

		if ( empty( $this->user_id ) && empty( $this->participant_id ) ) {
			return false;
		}

		$data = array(
			'attachment_id'  => $this->attachment_id,
			'user_id'        => $this->user_id,
			'participant_id' => $this->participant_id,
		);

		$format = array( '%d', '%d', '%d' );

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

		$table_name = $wpdb->prefix . 'fair_events_photo_likes';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
