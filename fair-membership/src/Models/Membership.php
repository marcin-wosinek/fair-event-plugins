<?php
/**
 * Membership model for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Models;

defined( 'WPINC' ) || die;

/**
 * Membership model class
 */
class Membership {

	/**
	 * Membership ID
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * User ID
	 *
	 * @var int
	 */
	public $user_id;

	/**
	 * Group ID
	 *
	 * @var int
	 */
	public $group_id;

	/**
	 * Membership status
	 *
	 * @var string Either 'active' or 'inactive'
	 */
	public $status;

	/**
	 * Membership start timestamp
	 *
	 * @var string
	 */
	public $started_at;

	/**
	 * Membership end timestamp
	 *
	 * @var string|null
	 */
	public $ended_at;

	/**
	 * Creation timestamp
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Last update timestamp
	 *
	 * @var string
	 */
	public $updated_at;

	/**
	 * Constructor
	 *
	 * @param array $data Optional data to populate the model.
	 */
	public function __construct( $data = array() ) {
		if ( ! empty( $data ) ) {
			$this->populate( $data );
		}
	}

	/**
	 * Populate model with data
	 *
	 * @param array $data Data to populate the model.
	 * @return void
	 */
	public function populate( $data ) {
		$this->id         = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->user_id    = isset( $data['user_id'] ) ? (int) $data['user_id'] : 0;
		$this->group_id   = isset( $data['group_id'] ) ? (int) $data['group_id'] : 0;
		$this->status     = isset( $data['status'] ) ? (string) $data['status'] : 'active';
		$this->started_at = isset( $data['started_at'] ) ? (string) $data['started_at'] : '';
		$this->ended_at   = isset( $data['ended_at'] ) ? (string) $data['ended_at'] : null;
		$this->created_at = isset( $data['created_at'] ) ? (string) $data['created_at'] : '';
		$this->updated_at = isset( $data['updated_at'] ) ? (string) $data['updated_at'] : '';
	}

	/**
	 * Convert model to array
	 *
	 * @return array
	 */
	public function to_array() {
		return array(
			'id'         => $this->id,
			'user_id'    => $this->user_id,
			'group_id'   => $this->group_id,
			'status'     => $this->status,
			'started_at' => $this->started_at,
			'ended_at'   => $this->ended_at,
			'created_at' => $this->created_at,
			'updated_at' => $this->updated_at,
		);
	}

	/**
	 * Save the membership to database
	 *
	 * @return bool True on success, false on failure.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_memberships';

		// Validate required fields
		$validation_errors = $this->validate();
		if ( ! empty( $validation_errors ) ) {
			return false;
		}

		$data = array(
			'user_id'    => $this->user_id,
			'group_id'   => $this->group_id,
			'status'     => $this->status,
			'started_at' => $this->started_at ?: current_time( 'mysql' ),
		);

		// Add ended_at if provided
		if ( $this->ended_at ) {
			$data['ended_at'] = $this->ended_at;
		}

		$format = array( '%d', '%d', '%s', '%s' );
		if ( $this->ended_at ) {
			$format[] = '%s';
		}

		if ( $this->id ) {
			// Update existing membership
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $this->id ),
				$format,
				array( '%d' )
			);
		} else {
			// Insert new membership
			$result = $wpdb->insert( $table_name, $data, $format );

			if ( $result ) {
				$this->id = $wpdb->insert_id;
			}
		}

		return $result !== false;
	}

	/**
	 * Delete the membership from database
	 *
	 * @return bool True on success, false on failure.
	 */
	public function delete() {
		global $wpdb;

		if ( ! $this->id ) {
			return false;
		}

		$table_name = $wpdb->prefix . 'fair_memberships';

		$result = $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		);

		return $result !== false;
	}

	/**
	 * Validate membership data
	 *
	 * @return array Array of error messages, empty if valid.
	 */
	public function validate() {
		$errors = array();

		if ( empty( $this->user_id ) ) {
			$errors[] = __( 'User ID is required.', 'fair-membership' );
		}

		if ( empty( $this->group_id ) ) {
			$errors[] = __( 'Group ID is required.', 'fair-membership' );
		}

		if ( ! in_array( $this->status, array( 'active', 'inactive' ), true ) ) {
			$errors[] = __( 'Status must be either "active" or "inactive".', 'fair-membership' );
		}

		// Validate that user exists
		if ( $this->user_id && ! get_userdata( $this->user_id ) ) {
			$errors[] = __( 'User does not exist.', 'fair-membership' );
		}

		// Validate that group exists
		if ( $this->group_id ) {
			$group = Group::get_by_id( $this->group_id );
			if ( ! $group ) {
				$errors[] = __( 'Group does not exist.', 'fair-membership' );
			}
		}

		return $errors;
	}

	/**
	 * Get membership by ID
	 *
	 * @param int $id Membership ID.
	 * @return Membership|null Membership object or null if not found.
	 */
	public static function get_by_id( $id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_memberships';

		$result = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$table_name} WHERE id = %d",
				$id
			),
			ARRAY_A
		);

		return $result ? new self( $result ) : null;
	}

	/**
	 * Get membership by user and group
	 *
	 * @param int $user_id User ID.
	 * @param int $group_id Group ID.
	 * @return Membership|null Membership object or null if not found.
	 */
	public static function get_by_user_and_group( $user_id, $group_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_memberships';

		$result = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$table_name} WHERE user_id = %d AND group_id = %d ORDER BY created_at DESC LIMIT 1",
				$user_id,
				$group_id
			),
			ARRAY_A
		);

		return $result ? new self( $result ) : null;
	}

	/**
	 * Get active membership by user and group
	 *
	 * @param int $user_id User ID.
	 * @param int $group_id Group ID.
	 * @return Membership|null Active membership object or null if not found.
	 */
	public static function get_active_by_user_and_group( $user_id, $group_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_memberships';

		$result = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$table_name} WHERE user_id = %d AND group_id = %d AND status = 'active' ORDER BY created_at DESC LIMIT 1",
				$user_id,
				$group_id
			),
			ARRAY_A
		);

		return $result ? new self( $result ) : null;
	}

	/**
	 * Get all memberships for a user
	 *
	 * @param int $user_id User ID.
	 * @return array Array of Membership objects.
	 */
	public static function get_by_user( $user_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_memberships';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$table_name} WHERE user_id = %d ORDER BY created_at DESC",
				$user_id
			),
			ARRAY_A
		);

		return array_map( array( __CLASS__, 'create_from_array' ), $results );
	}

	/**
	 * Get all memberships for a group
	 *
	 * @param int $group_id Group ID.
	 * @return array Array of Membership objects.
	 */
	public static function get_by_group( $group_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_memberships';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$table_name} WHERE group_id = %d ORDER BY created_at DESC",
				$group_id
			),
			ARRAY_A
		);

		return array_map( array( __CLASS__, 'create_from_array' ), $results );
	}

	/**
	 * Get active memberships for a group
	 *
	 * @param int $group_id Group ID.
	 * @return array Array of Membership objects.
	 */
	public static function get_active_by_group( $group_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_memberships';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$table_name} WHERE group_id = %d AND status = 'active' ORDER BY created_at DESC",
				$group_id
			),
			ARRAY_A
		);

		return array_map( array( __CLASS__, 'create_from_array' ), $results );
	}

	/**
	 * Count active memberships for a group
	 *
	 * @param int $group_id Group ID.
	 * @return int Number of active members.
	 */
	public static function count_active_by_group( $group_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_memberships';

		$count = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$table_name} WHERE group_id = %d AND status = 'active'",
				$group_id
			)
		);

		return (int) $count;
	}

	/**
	 * Create Membership instance from array
	 *
	 * @param array $data Array data.
	 * @return Membership Membership instance.
	 */
	public static function create_from_array( $data ) {
		return new self( $data );
	}

	/**
	 * Get user data for this membership
	 *
	 * @return WP_User|false User object or false if not found.
	 */
	public function get_user() {
		return get_userdata( $this->user_id );
	}

	/**
	 * Get group data for this membership
	 *
	 * @return Group|null Group object or null if not found.
	 */
	public function get_group() {
		return Group::get_by_id( $this->group_id );
	}

	/**
	 * Check if membership is currently active
	 *
	 * @return bool True if active, false otherwise.
	 */
	public function is_active() {
		if ( $this->status !== 'active' ) {
			return false;
		}

		// If there's an end date and it's in the past, membership is not active
		if ( $this->ended_at && strtotime( $this->ended_at ) < time() ) {
			return false;
		}

		return true;
	}

	/**
	 * End this membership
	 *
	 * @param string $end_date Optional end date, defaults to current time.
	 * @return bool True on success, false on failure.
	 */
	public function end( $end_date = null ) {
		$this->status   = 'inactive';
		$this->ended_at = $end_date ?: current_time( 'mysql' );

		return $this->save();
	}
}
