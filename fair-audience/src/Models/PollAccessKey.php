<?php
/**
 * Poll Access Key Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Poll access key model.
 */
class PollAccessKey {

	/**
	 * Access key ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Poll ID.
	 *
	 * @var int
	 */
	public $poll_id;

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
	 * Key status.
	 *
	 * @var string
	 */
	public $status;

	/**
	 * Sent timestamp.
	 *
	 * @var string|null
	 */
	public $sent_at;

	/**
	 * Responded timestamp.
	 *
	 * @var string|null
	 */
	public $responded_at;

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
		$this->poll_id        = isset( $data['poll_id'] ) ? (int) $data['poll_id'] : 0;
		$this->participant_id = isset( $data['participant_id'] ) ? (int) $data['participant_id'] : 0;
		$this->access_key     = isset( $data['access_key'] ) ? $data['access_key'] : '';
		$this->token          = isset( $data['token'] ) ? $data['token'] : '';
		$this->status         = isset( $data['status'] ) ? $data['status'] : 'pending';
		$this->sent_at        = isset( $data['sent_at'] ) ? $data['sent_at'] : null;
		$this->responded_at   = isset( $data['responded_at'] ) ? $data['responded_at'] : null;
		$this->created_at     = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_poll_access_keys';

		// Validate required fields.
		if ( empty( $this->poll_id ) || empty( $this->participant_id ) || empty( $this->access_key ) || empty( $this->token ) ) {
			return false;
		}

		// Validate status enum.
		if ( ! in_array( $this->status, array( 'pending', 'responded', 'expired' ), true ) ) {
			$this->status = 'pending';
		}

		$data = array(
			'poll_id'        => $this->poll_id,
			'participant_id' => $this->participant_id,
			'access_key'     => $this->access_key,
			'token'          => $this->token,
			'status'         => $this->status,
			'sent_at'        => $this->sent_at,
			'responded_at'   => $this->responded_at,
		);

		$format = array( '%d', '%d', '%s', '%s', '%s', '%s', '%s' );

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
	 * Mark as responded.
	 *
	 * @return bool Success.
	 */
	public function mark_as_responded() {
		$this->status       = 'responded';
		$this->responded_at = current_time( 'mysql' );
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

		$table_name = $wpdb->prefix . 'fair_audience_poll_access_keys';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
