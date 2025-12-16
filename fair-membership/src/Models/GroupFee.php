<?php
/**
 * GroupFee model for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Models;

defined( 'WPINC' ) || die;

/**
 * GroupFee model class
 *
 * Represents a fee template applied to all members of a group.
 */
class GroupFee {

	/**
	 * GroupFee ID
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Fee title
	 *
	 * @var string
	 */
	public $title;

	/**
	 * Fee description
	 *
	 * @var string|null
	 */
	public $description;

	/**
	 * Default amount for the fee
	 *
	 * @var float
	 */
	public $default_amount;

	/**
	 * Due date for payment
	 *
	 * @var string Date in YYYY-MM-DD format
	 */
	public $due_date;

	/**
	 * Group ID this fee is for
	 *
	 * @var int
	 */
	public $group_id;

	/**
	 * ID of user who created the fee
	 *
	 * @var int|null
	 */
	public $created_by;

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
		$this->id             = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->title          = isset( $data['title'] ) ? (string) $data['title'] : '';
		$this->description    = isset( $data['description'] ) ? (string) $data['description'] : null;
		$this->default_amount = isset( $data['default_amount'] ) ? (float) $data['default_amount'] : 0.0;
		$this->due_date       = isset( $data['due_date'] ) ? (string) $data['due_date'] : '';
		$this->group_id       = isset( $data['group_id'] ) ? (int) $data['group_id'] : 0;
		$this->created_by     = isset( $data['created_by'] ) ? (int) $data['created_by'] : null;
		$this->created_at     = isset( $data['created_at'] ) ? (string) $data['created_at'] : '';
		$this->updated_at     = isset( $data['updated_at'] ) ? (string) $data['updated_at'] : '';
	}

	/**
	 * Convert model to array
	 *
	 * @return array
	 */
	public function to_array() {
		return array(
			'id'             => $this->id,
			'title'          => $this->title,
			'description'    => $this->description,
			'default_amount' => $this->default_amount,
			'due_date'       => $this->due_date,
			'group_id'       => $this->group_id,
			'created_by'     => $this->created_by,
			'created_at'     => $this->created_at,
			'updated_at'     => $this->updated_at,
		);
	}

	/**
	 * Get a group fee by ID
	 *
	 * @param int $id Group fee ID.
	 * @return GroupFee|null GroupFee object or null if not found.
	 */
	public static function get_by_id( $id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_group_fees';

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d',
				$table_name,
				$id
			),
			ARRAY_A
		);

		return $result ? new self( $result ) : null;
	}

	/**
	 * Get all group fees
	 *
	 * @param array $args Query arguments.
	 * @return GroupFee[]
	 */
	public static function get_all( $args = array() ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_group_fees';
		$defaults   = array(
			'group_id' => null,
			'orderby'  => 'created_at',
			'order'    => 'DESC',
			'limit'    => null,
			'offset'   => 0,
		);

		$args = wp_parse_args( $args, $defaults );

		$where_conditions = array();
		$where_values     = array();

		if ( ! is_null( $args['group_id'] ) ) {
			$where_conditions[] = 'group_id = %d';
			$where_values[]     = $args['group_id'];
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

		$prepare_values = array_merge( array( $table_name ), $where_values );

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i {$where_clause} {$order_clause} {$limit_clause}",
				$prepare_values
			),
			ARRAY_A
		);

		$group_fees = array();
		foreach ( $results as $result ) {
			$group_fees[] = new self( $result );
		}

		return $group_fees;
	}

	/**
	 * Save the group fee (create or update)
	 *
	 * @return bool|int False on failure, group fee ID on success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_group_fees';
		$data       = array(
			'title'          => $this->title,
			'description'    => $this->description,
			'default_amount' => $this->default_amount,
			'due_date'       => $this->due_date,
			'group_id'       => $this->group_id,
			'created_by'     => $this->created_by,
		);

		$format = array( '%s', '%s', '%f', '%s', '%d', '%d' );

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
	 * Delete the group fee
	 *
	 * @return bool True on success, false on failure.
	 */
	public function delete() {
		if ( ! $this->id ) {
			return false;
		}

		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_group_fees';
		$result     = $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Get total count of group fees
	 *
	 * @param array $args Query arguments.
	 * @return int
	 */
	public static function get_count( $args = array() ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_group_fees';
		$defaults   = array(
			'group_id' => null,
		);

		$args = wp_parse_args( $args, $defaults );

		$where_conditions = array();
		$where_values     = array();

		if ( ! is_null( $args['group_id'] ) ) {
			$where_conditions[] = 'group_id = %d';
			$where_values[]     = $args['group_id'];
		}

		$where_clause = ! empty( $where_conditions ) ? 'WHERE ' . implode( ' AND ', $where_conditions ) : '';

		$prepare_values = array_merge( array( $table_name ), $where_values );

		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i {$where_clause}",
				$prepare_values
			)
		);
	}

	/**
	 * Validate group fee data
	 *
	 * @return bool|WP_Error True if valid, WP_Error otherwise.
	 */
	public function validate() {
		if ( empty( $this->title ) ) {
			return new \WP_Error( 'missing_title', __( 'Title is required.', 'fair-membership' ) );
		}

		if ( ! is_numeric( $this->default_amount ) || $this->default_amount < 0 ) {
			return new \WP_Error( 'invalid_amount', __( 'Amount must be a positive number.', 'fair-membership' ) );
		}

		if ( empty( $this->due_date ) ) {
			return new \WP_Error( 'missing_due_date', __( 'Due date is required.', 'fair-membership' ) );
		}

		if ( empty( $this->group_id ) ) {
			return new \WP_Error( 'missing_group_id', __( 'Group ID is required.', 'fair-membership' ) );
		}

		// Verify group exists
		$group = Group::get_by_id( $this->group_id );
		if ( ! $group ) {
			return new \WP_Error( 'invalid_group', __( 'Invalid group ID.', 'fair-membership' ) );
		}

		return true;
	}
}
