<?php
/**
 * Gallery Access Key Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Gallery access key model.
 */
class GalleryAccessKey {

	/**
	 * Access key ID.
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
	 * Participant ID.
	 *
	 * @var int
	 */
	public $participant_id;

	/**
	 * Access key (SHA-256 hash).
	 *
	 * @var string
	 */
	public $access_key;

	/**
	 * Original token (for URL generation).
	 *
	 * @var string
	 */
	public $token;

	/**
	 * Sent timestamp.
	 *
	 * @var string|null
	 */
	public $sent_at;

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
		$this->event_id       = isset( $data['event_id'] ) ? (int) $data['event_id'] : 0;
		$this->participant_id = isset( $data['participant_id'] ) ? (int) $data['participant_id'] : 0;
		$this->access_key     = isset( $data['access_key'] ) ? $data['access_key'] : '';
		$this->token          = isset( $data['token'] ) ? $data['token'] : '';
		$this->sent_at        = isset( $data['sent_at'] ) ? $data['sent_at'] : null;
		$this->created_at     = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_gallery_access_keys';

		// Validate required fields.
		if ( empty( $this->event_id ) || empty( $this->participant_id ) || empty( $this->access_key ) || empty( $this->token ) ) {
			return false;
		}

		$data = array(
			'event_id'       => $this->event_id,
			'participant_id' => $this->participant_id,
			'access_key'     => $this->access_key,
			'token'          => $this->token,
			'sent_at'        => $this->sent_at,
		);

		$format = array( '%d', '%d', '%s', '%s', '%s' );

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
	 * Mark as sent.
	 *
	 * @return bool Success.
	 */
	public function mark_as_sent() {
		$this->sent_at = current_time( 'mysql' );
		return $this->save();
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

		$table_name = $wpdb->prefix . 'fair_audience_gallery_access_keys';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
