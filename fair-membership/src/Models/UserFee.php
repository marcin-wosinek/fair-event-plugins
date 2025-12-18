<?php
/**
 * UserFee model for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Models;

defined( 'WPINC' ) || die;

/**
 * UserFee model class
 *
 * Represents a fee owed by a specific user.
 * Can be linked to a GroupFee or standalone (individual/extraordinary fee).
 */
class UserFee {

	/**
	 * UserFee ID
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * GroupFee ID (NULL for individual fees)
	 *
	 * @var int|null
	 */
	public $group_fee_id;

	/**
	 * User ID (NULL if user was deleted)
	 *
	 * @var int|null
	 */
	public $user_id;

	/**
	 * Fee title
	 *
	 * @var string
	 */
	public $title;

	/**
	 * Fee amount
	 *
	 * @var float
	 */
	public $amount;

	/**
	 * Due date for payment
	 *
	 * @var string Date in YYYY-MM-DD format
	 */
	public $due_date;

	/**
	 * Payment status
	 *
	 * @var string Either 'pending', 'pending_payment', 'paid', 'cancelled', or 'overdue'
	 */
	public $status;

	/**
	 * Timestamp when marked as paid
	 *
	 * @var string|null
	 */
	public $paid_at;

	/**
	 * Admin notes about this fee
	 *
	 * @var string|null
	 */
	public $notes;

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
		$this->id           = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->group_fee_id = isset( $data['group_fee_id'] ) && null !== $data['group_fee_id'] ? (int) $data['group_fee_id'] : null;
		$this->user_id      = isset( $data['user_id'] ) && null !== $data['user_id'] ? (int) $data['user_id'] : null;
		$this->title        = isset( $data['title'] ) ? (string) $data['title'] : '';
		$this->amount       = isset( $data['amount'] ) ? (float) $data['amount'] : 0.0;
		$this->due_date     = isset( $data['due_date'] ) ? (string) $data['due_date'] : '';
		$this->status       = isset( $data['status'] ) ? (string) $data['status'] : 'pending';
		$this->paid_at      = isset( $data['paid_at'] ) ? (string) $data['paid_at'] : null;
		$this->notes        = isset( $data['notes'] ) ? (string) $data['notes'] : null;
		$this->created_at   = isset( $data['created_at'] ) ? (string) $data['created_at'] : '';
		$this->updated_at   = isset( $data['updated_at'] ) ? (string) $data['updated_at'] : '';
	}

	/**
	 * Convert model to array
	 *
	 * @return array
	 */
	public function to_array() {
		return array(
			'id'           => $this->id,
			'group_fee_id' => $this->group_fee_id,
			'user_id'      => $this->user_id,
			'title'        => $this->title,
			'amount'       => $this->amount,
			'due_date'     => $this->due_date,
			'status'       => $this->status,
			'paid_at'      => $this->paid_at,
			'notes'        => $this->notes,
			'created_at'   => $this->created_at,
			'updated_at'   => $this->updated_at,
		);
	}

	/**
	 * Get a user fee by ID
	 *
	 * @param int $id User fee ID.
	 * @return UserFee|null UserFee object or null if not found.
	 */
	public static function get_by_id( $id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_user_fees';

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
	 * Get all user fees
	 *
	 * @param array $args Query arguments.
	 * @return UserFee[]
	 */
	public static function get_all( $args = array() ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_user_fees';
		$defaults   = array(
			'group_fee_id' => null,
			'user_id'      => null,
			'status'       => null,
			'orderby'      => 'created_at',
			'order'        => 'DESC',
			'limit'        => null,
			'offset'       => 0,
		);

		$args = wp_parse_args( $args, $defaults );

		$where_conditions = array();
		$where_values     = array();

		if ( ! is_null( $args['group_fee_id'] ) ) {
			$where_conditions[] = 'group_fee_id = %d';
			$where_values[]     = $args['group_fee_id'];
		}

		if ( ! is_null( $args['user_id'] ) ) {
			$where_conditions[] = 'user_id = %d';
			$where_values[]     = $args['user_id'];
		}

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

		$prepare_values = array_merge( array( $table_name ), $where_values );

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i {$where_clause} {$order_clause} {$limit_clause}",
				$prepare_values
			),
			ARRAY_A
		);

		$user_fees = array();
		foreach ( $results as $result ) {
			$user_fees[] = new self( $result );
		}

		return $user_fees;
	}

	/**
	 * Save the user fee (create or update)
	 *
	 * @return bool|int False on failure, user fee ID on success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_user_fees';
		$data       = array(
			'group_fee_id' => $this->group_fee_id,
			'user_id'      => $this->user_id,
			'title'        => $this->title,
			'amount'       => $this->amount,
			'due_date'     => $this->due_date,
			'status'       => $this->status,
			'paid_at'      => $this->paid_at,
			'notes'        => $this->notes,
		);

		$format = array( '%d', '%d', '%s', '%f', '%s', '%s', '%s', '%s' );

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
	 * Delete the user fee
	 *
	 * @return bool True on success, false on failure.
	 */
	public function delete() {
		if ( ! $this->id ) {
			return false;
		}

		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_user_fees';
		$result     = $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Get total count of user fees
	 *
	 * @param array $args Query arguments.
	 * @return int
	 */
	public static function get_count( $args = array() ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_user_fees';
		$defaults   = array(
			'group_fee_id' => null,
			'user_id'      => null,
			'status'       => null,
		);

		$args = wp_parse_args( $args, $defaults );

		$where_conditions = array();
		$where_values     = array();

		if ( ! is_null( $args['group_fee_id'] ) ) {
			$where_conditions[] = 'group_fee_id = %d';
			$where_values[]     = $args['group_fee_id'];
		}

		if ( ! is_null( $args['user_id'] ) ) {
			$where_conditions[] = 'user_id = %d';
			$where_values[]     = $args['user_id'];
		}

		if ( ! is_null( $args['status'] ) ) {
			$where_conditions[] = 'status = %s';
			$where_values[]     = $args['status'];
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
	 * Validate user fee data
	 *
	 * @return bool|\WP_Error True if valid, WP_Error otherwise.
	 */
	public function validate() {
		if ( empty( $this->title ) ) {
			return new \WP_Error( 'missing_title', __( 'Title is required.', 'fair-membership' ) );
		}

		if ( ! is_numeric( $this->amount ) || $this->amount < 0 ) {
			return new \WP_Error( 'invalid_amount', __( 'Amount must be a positive number.', 'fair-membership' ) );
		}

		$valid_statuses = array( 'pending', 'pending_payment', 'paid', 'cancelled', 'overdue' );
		if ( ! in_array( $this->status, $valid_statuses, true ) ) {
			return new \WP_Error( 'invalid_status', __( 'Invalid status.', 'fair-membership' ) );
		}

		return true;
	}

	/**
	 * Mark fee as paid
	 *
	 * @return bool True on success, false on failure.
	 */
	public function mark_as_paid() {
		$this->status  = 'paid';
		$this->paid_at = current_time( 'mysql' );
		return false !== $this->save();
	}
}
