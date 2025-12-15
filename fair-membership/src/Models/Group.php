<?php
/**
 * Group model for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Models;

defined( 'WPINC' ) || die;

/**
 * Group model class
 */
class Group {

	/**
	 * Group ID
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Group name
	 *
	 * @var string
	 */
	public $name;

	/**
	 * Group slug
	 *
	 * @var string
	 */
	public $slug;

	/**
	 * Group description
	 *
	 * @var string|null
	 */
	public $description;

	/**
	 * Access control type
	 *
	 * @var string Either 'open' or 'managed'
	 */
	public $access_control;

	/**
	 * Group status
	 *
	 * @var string Either 'active' or 'inactive'
	 */
	public $status;

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
	 * ID of user who created the group
	 *
	 * @var int|null
	 */
	public $created_by;

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
		$this->id             = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->name           = isset( $data['name'] ) ? (string) $data['name'] : '';
		$this->slug           = isset( $data['slug'] ) ? (string) $data['slug'] : '';
		$this->description    = isset( $data['description'] ) ? (string) $data['description'] : null;
		$this->access_control = isset( $data['access_control'] ) ? (string) $data['access_control'] : 'open';
		$this->status         = isset( $data['status'] ) ? (string) $data['status'] : 'active';
		$this->created_at     = isset( $data['created_at'] ) ? (string) $data['created_at'] : '';
		$this->updated_at     = isset( $data['updated_at'] ) ? (string) $data['updated_at'] : '';
		$this->created_by     = isset( $data['created_by'] ) ? (int) $data['created_by'] : null;
	}

	/**
	 * Convert model to array
	 *
	 * @param bool $include_member_count Whether to include member count (default: false).
	 * @return array
	 */
	public function to_array( $include_member_count = false ) {
		$data = array(
			'id'             => $this->id,
			'name'           => $this->name,
			'slug'           => $this->slug,
			'description'    => $this->description,
			'access_control' => $this->access_control,
			'status'         => $this->status,
			'created_at'     => $this->created_at,
			'updated_at'     => $this->updated_at,
			'created_by'     => $this->created_by,
		);

		if ( $include_member_count ) {
			$data['member_count'] = $this->get_member_count();
		}

		return $data;
	}

	/**
	 * Get the number of active members in this group
	 *
	 * @return int Number of active members.
	 */
	public function get_member_count() {
		if ( ! $this->id ) {
			return 0;
		}

		return Membership::count_active_by_group( $this->id );
	}

	/**
	 * Get all groups
	 *
	 * @param array $args Query arguments.
	 * @return Group[]
	 */
	public static function get_all( $args = array() ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_groups';
		$defaults   = array(
			'status'  => null,
			'orderby' => 'name',
			'order'   => 'ASC',
			'limit'   => null,
			'offset'  => 0,
		);

		$args = wp_parse_args( $args, $defaults );

		$where_conditions = array();
		$where_values     = array();

		if ( ! is_null( $args['status'] ) ) {
			$where_conditions[] = 'status = %s';
			$where_values[]     = $args['status'];
		}

		$where_clause = ! empty( $where_conditions ) ? 'WHERE ' . implode( ' AND ', $where_conditions ) : '';

		$order_clause = sprintf(
			'ORDER BY %s %s',
			esc_sql( $args['orderby'] ),
			'DESC' === strtoupper( $args['order'] ) ? 'DESC' : 'ASC'
		);

		$limit_clause = '';
		if ( ! is_null( $args['limit'] ) ) {
			$limit_clause = $wpdb->prepare( 'LIMIT %d OFFSET %d', $args['limit'], $args['offset'] );
		}

		$query = "SELECT * FROM {$table_name} {$where_clause} {$order_clause} {$limit_clause}";

		if ( ! empty( $where_values ) ) {
			$query = $wpdb->prepare( $query, $where_values );
		}

		$results = $wpdb->get_results( $query, ARRAY_A );

		$groups = array();
		if ( $results ) {
			foreach ( $results as $row ) {
				$groups[] = new self( $row );
			}
		}

		return $groups;
	}

	/**
	 * Get group by ID
	 *
	 * @param int $id Group ID.
	 * @return Group|null
	 */
	public static function get_by_id( $id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_groups';
		$query      = $wpdb->prepare( "SELECT * FROM {$table_name} WHERE id = %d", $id );
		$result     = $wpdb->get_row( $query, ARRAY_A );

		return $result ? new self( $result ) : null;
	}

	/**
	 * Get group by slug
	 *
	 * @param string $slug Group slug.
	 * @return Group|null
	 */
	public static function get_by_slug( $slug ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_groups';
		$query      = $wpdb->prepare( "SELECT * FROM {$table_name} WHERE slug = %s", $slug );
		$result     = $wpdb->get_row( $query, ARRAY_A );

		return $result ? new self( $result ) : null;
	}

	/**
	 * Save the group (insert or update)
	 *
	 * @return bool|int False on failure, group ID on success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_groups';
		$data       = array(
			'name'           => $this->name,
			'slug'           => $this->slug,
			'description'    => $this->description,
			'access_control' => $this->access_control,
			'status'         => $this->status,
			'created_by'     => $this->created_by,
		);

		$format = array( '%s', '%s', '%s', '%s', '%s', '%d' );

		if ( $this->id ) {
			$where        = array( 'id' => $this->id );
			$where_format = array( '%d' );
			$result       = $wpdb->update( $table_name, $data, $where, $format, $where_format );
			return false !== $result ? $this->id : false;
		} else {
			$result = $wpdb->insert( $table_name, $data, $format );
			if ( $result ) {
				$this->id = $wpdb->insert_id;
				return $this->id;
			}
			return false;
		}
	}

	/**
	 * Delete the group
	 *
	 * @return bool True on success, false on failure.
	 */
	public function delete() {
		if ( ! $this->id ) {
			return false;
		}

		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_groups';
		$result     = $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Get total count of groups
	 *
	 * @param array $args Query arguments.
	 * @return int
	 */
	public static function count( $args = array() ) {
		global $wpdb;

		$table_name       = $wpdb->prefix . 'fair_groups';
		$where_conditions = array();
		$where_values     = array();

		if ( isset( $args['status'] ) && ! is_null( $args['status'] ) ) {
			$where_conditions[] = 'status = %s';
			$where_values[]     = $args['status'];
		}

		$where_clause = ! empty( $where_conditions ) ? 'WHERE ' . implode( ' AND ', $where_conditions ) : '';
		$query        = "SELECT COUNT(*) FROM {$table_name} {$where_clause}";

		if ( ! empty( $where_values ) ) {
			$query = $wpdb->prepare( $query, $where_values );
		}

		return (int) $wpdb->get_var( $query );
	}

	/**
	 * Validate group data
	 *
	 * @return array Array of error messages, empty if valid.
	 */
	public function validate() {
		$errors = array();

		if ( empty( $this->name ) ) {
			$errors[] = __( 'Group name is required.', 'fair-membership' );
		}

		if ( empty( $this->slug ) ) {
			$errors[] = __( 'Group slug is required.', 'fair-membership' );
		} elseif ( ! preg_match( '/^[a-z0-9-]+$/', $this->slug ) ) {
			$errors[] = __( 'Group slug can only contain lowercase letters, numbers, and hyphens.', 'fair-membership' );
		}

		if ( ! in_array( $this->access_control, array( 'open', 'managed' ), true ) ) {
			$errors[] = __( 'Invalid access control type.', 'fair-membership' );
		}

		if ( ! in_array( $this->status, array( 'active', 'inactive' ), true ) ) {
			$errors[] = __( 'Invalid status.', 'fair-membership' );
		}

		if ( ! empty( $this->slug ) ) {
			$existing = self::get_by_slug( $this->slug );
			if ( $existing && ( ! $this->id || $existing->id !== $this->id ) ) {
				$errors[] = __( 'A group with this slug already exists.', 'fair-membership' );
			}
		}

		return $errors;
	}
}
