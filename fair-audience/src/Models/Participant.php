<?php
/**
 * Participant Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Participant model.
 */
class Participant {

	/**
	 * Participant ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * First name.
	 *
	 * @var string
	 */
	public $name;

	/**
	 * Surname.
	 *
	 * @var string
	 */
	public $surname;

	/**
	 * Email address.
	 *
	 * @var string
	 */
	public $email;

	/**
	 * Instagram handle (without @).
	 *
	 * @var string
	 */
	public $instagram;

	/**
	 * Email profile preference.
	 *
	 * @var string
	 */
	public $email_profile;

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
		$this->id            = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->name          = isset( $data['name'] ) ? sanitize_text_field( $data['name'] ) : '';
		$this->surname       = isset( $data['surname'] ) ? sanitize_text_field( $data['surname'] ) : '';
		$this->email         = isset( $data['email'] ) ? sanitize_email( $data['email'] ) : '';
		$this->instagram     = isset( $data['instagram'] ) ? sanitize_text_field( $data['instagram'] ) : '';
		$this->email_profile = isset( $data['email_profile'] ) ? $data['email_profile'] : 'minimal';
		$this->created_at    = isset( $data['created_at'] ) ? $data['created_at'] : '';
		$this->updated_at    = isset( $data['updated_at'] ) ? $data['updated_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_participants';

		// Validate required fields.
		if ( empty( $this->name ) || empty( $this->surname ) || empty( $this->email ) ) {
			return false;
		}

		// Validate email_profile enum.
		if ( ! in_array( $this->email_profile, array( 'minimal', 'in_the_loop' ), true ) ) {
			$this->email_profile = 'minimal';
		}

		$data = array(
			'name'          => $this->name,
			'surname'       => $this->surname,
			'email'         => $this->email,
			'instagram'     => $this->instagram,
			'email_profile' => $this->email_profile,
		);

		$format = array( '%s', '%s', '%s', '%s', '%s' );

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

		$table_name = $wpdb->prefix . 'fair_audience_participants';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
