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
	 * Subscription status (pending or confirmed).
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
		$this->id            = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->name          = isset( $data['name'] ) ? sanitize_text_field( $data['name'] ) : '';
		$this->surname       = isset( $data['surname'] ) ? sanitize_text_field( $data['surname'] ) : '';
		$this->email         = isset( $data['email'] ) ? sanitize_email( $data['email'] ) : '';
		$this->instagram     = isset( $data['instagram'] ) ? sanitize_text_field( $data['instagram'] ) : '';
		$this->email_profile = isset( $data['email_profile'] ) ? $data['email_profile'] : 'minimal';
		$this->status        = isset( $data['status'] ) ? $data['status'] : 'confirmed';
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

		// Validate required fields (email is optional).
		if ( empty( $this->name ) || empty( $this->surname ) ) {
			return false;
		}

		// Validate email_profile enum.
		if ( ! in_array( $this->email_profile, array( 'minimal', 'in_the_loop' ), true ) ) {
			$this->email_profile = 'minimal';
		}

		// Validate status enum.
		if ( ! in_array( $this->status, array( 'pending', 'confirmed' ), true ) ) {
			$this->status = 'confirmed';
		}

		// Convert empty email to null for database storage.
		$email = ! empty( $this->email ) ? $this->email : null;

		if ( $this->id ) {
			// Update existing - use raw query to properly handle NULL email.
			if ( null === $email ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$result = $wpdb->query(
					$wpdb->prepare(
						"UPDATE {$table_name} SET name = %s, surname = %s, instagram = %s, email_profile = %s, status = %s, email = NULL WHERE id = %d",
						$this->name,
						$this->surname,
						$this->instagram,
						$this->email_profile,
						$this->status,
						$this->id
					)
				);
			} else {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$result = $wpdb->update(
					$table_name,
					array(
						'name'          => $this->name,
						'surname'       => $this->surname,
						'email'         => $email,
						'instagram'     => $this->instagram,
						'email_profile' => $this->email_profile,
						'status'        => $this->status,
					),
					array( 'id' => $this->id ),
					array( '%s', '%s', '%s', '%s', '%s', '%s' ),
					array( '%d' )
				);
			}
		} else {
			// Insert new - use raw query to properly handle NULL email.
			if ( null === $email ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$result = $wpdb->query(
					$wpdb->prepare(
						"INSERT INTO {$table_name} (name, surname, instagram, email_profile, status, email) VALUES (%s, %s, %s, %s, %s, NULL)",
						$this->name,
						$this->surname,
						$this->instagram,
						$this->email_profile,
						$this->status
					)
				);
				if ( $result ) {
					$this->id = $wpdb->insert_id;
				}
			} else {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$result = $wpdb->insert(
					$table_name,
					array(
						'name'          => $this->name,
						'surname'       => $this->surname,
						'email'         => $email,
						'instagram'     => $this->instagram,
						'email_profile' => $this->email_profile,
						'status'        => $this->status,
					),
					array( '%s', '%s', '%s', '%s', '%s', '%s' )
				);
				if ( $result ) {
					$this->id = $wpdb->insert_id;
				}
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
