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
	 * WordPress user ID (if linked to a WP user).
	 *
	 * @var int|null
	 */
	public $wp_user_id;

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
		$this->wp_user_id    = isset( $data['wp_user_id'] ) && $data['wp_user_id'] ? (int) $data['wp_user_id'] : null;
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

		// Validate required fields (email and surname are optional).
		if ( empty( $this->name ) ) {
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

		// Build the SQL parts for nullable fields.
		$email_sql      = null === $email ? 'email = NULL' : 'email = %s';
		$wp_user_id_sql = null === $this->wp_user_id ? 'wp_user_id = NULL' : 'wp_user_id = %d';

		if ( $this->id ) {
			// Update existing - use raw query to properly handle NULL values.
			$sql  = "UPDATE {$table_name} SET name = %s, surname = %s, instagram = %s, email_profile = %s, status = %s, {$email_sql}, {$wp_user_id_sql} WHERE id = %d";
			$args = array(
				$this->name,
				$this->surname,
				$this->instagram,
				$this->email_profile,
				$this->status,
			);
			if ( null !== $email ) {
				$args[] = $email;
			}
			if ( null !== $this->wp_user_id ) {
				$args[] = $this->wp_user_id;
			}
			$args[] = $this->id;

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared
			$result = $wpdb->query( $wpdb->prepare( $sql, $args ) );
		} else {
			// Insert new - use raw query to properly handle NULL values.
			$email_col      = null === $email ? 'NULL' : '%s';
			$wp_user_id_col = null === $this->wp_user_id ? 'NULL' : '%d';

			$sql  = "INSERT INTO {$table_name} (name, surname, instagram, email_profile, status, email, wp_user_id) VALUES (%s, %s, %s, %s, %s, {$email_col}, {$wp_user_id_col})";
			$args = array(
				$this->name,
				$this->surname,
				$this->instagram,
				$this->email_profile,
				$this->status,
			);
			if ( null !== $email ) {
				$args[] = $email;
			}
			if ( null !== $this->wp_user_id ) {
				$args[] = $this->wp_user_id;
			}

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared
			$result = $wpdb->query( $wpdb->prepare( $sql, $args ) );
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
