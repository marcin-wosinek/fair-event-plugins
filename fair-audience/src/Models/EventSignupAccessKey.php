<?php
/**
 * Event Signup Access Key Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Event signup access key model.
 */
class EventSignupAccessKey {

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
		$this->created_at     = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_event_signup_access_keys';

		// Validate required fields.
		if ( empty( $this->event_id ) || empty( $this->participant_id ) || empty( $this->access_key ) || empty( $this->token ) ) {
			return false;
		}

		$data = array(
			'event_id'       => $this->event_id,
			'participant_id' => $this->participant_id,
			'access_key'     => $this->access_key,
			'token'          => $this->token,
		);

		$format = array( '%d', '%d', '%s', '%s' );

		// phpcs:disable WordPress.DB.DirectDatabaseQuery
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
		// phpcs:enable WordPress.DB.DirectDatabaseQuery

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

		$table_name = $wpdb->prefix . 'fair_audience_event_signup_access_keys';

		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
		// phpcs:enable WordPress.DB.DirectDatabaseQuery
	}
}
