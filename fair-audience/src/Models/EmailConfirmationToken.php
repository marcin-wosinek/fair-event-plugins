<?php
/**
 * Email Confirmation Token Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Email confirmation token model.
 */
class EmailConfirmationToken {

	/**
	 * Token ID.
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
	 * Token string.
	 *
	 * @var string
	 */
	public $token;

	/**
	 * Expiration timestamp.
	 *
	 * @var string
	 */
	public $expires_at;

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
		$this->token          = isset( $data['token'] ) ? $data['token'] : '';
		$this->expires_at     = isset( $data['expires_at'] ) ? $data['expires_at'] : '';
		$this->created_at     = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Check if token is expired.
	 *
	 * @return bool True if expired.
	 */
	public function is_expired() {
		if ( empty( $this->expires_at ) ) {
			return true;
		}

		$expires = strtotime( $this->expires_at );
		return $expires < time();
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_email_confirmation_tokens';

		// Validate required fields.
		if ( empty( $this->participant_id ) || empty( $this->token ) || empty( $this->expires_at ) ) {
			return false;
		}

		$data = array(
			'participant_id' => $this->participant_id,
			'token'          => $this->token,
			'expires_at'     => $this->expires_at,
		);

		$format = array( '%d', '%s', '%s' );

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

		$table_name = $wpdb->prefix . 'fair_audience_email_confirmation_tokens';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
