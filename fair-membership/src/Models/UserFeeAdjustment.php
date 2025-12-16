<?php
/**
 * UserFeeAdjustment model for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Models;

defined( 'WPINC' ) || die;

/**
 * UserFeeAdjustment model class
 *
 * Represents an audit trail record of amount adjustments to UserFees.
 */
class UserFeeAdjustment {

	/**
	 * Adjustment ID
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * UserFee ID this adjustment is for
	 *
	 * @var int
	 */
	public $user_fee_id;

	/**
	 * Previous amount before adjustment
	 *
	 * @var float
	 */
	public $previous_amount;

	/**
	 * New amount after adjustment
	 *
	 * @var float
	 */
	public $new_amount;

	/**
	 * Reason for the adjustment
	 *
	 * @var string
	 */
	public $reason;

	/**
	 * ID of user who made the adjustment
	 *
	 * @var int|null
	 */
	public $adjusted_by;

	/**
	 * Timestamp of adjustment
	 *
	 * @var string
	 */
	public $adjusted_at;

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
		$this->id              = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->user_fee_id     = isset( $data['user_fee_id'] ) ? (int) $data['user_fee_id'] : 0;
		$this->previous_amount = isset( $data['previous_amount'] ) ? (float) $data['previous_amount'] : 0.0;
		$this->new_amount      = isset( $data['new_amount'] ) ? (float) $data['new_amount'] : 0.0;
		$this->reason          = isset( $data['reason'] ) ? (string) $data['reason'] : '';
		$this->adjusted_by     = isset( $data['adjusted_by'] ) && null !== $data['adjusted_by'] ? (int) $data['adjusted_by'] : null;
		$this->adjusted_at     = isset( $data['adjusted_at'] ) ? (string) $data['adjusted_at'] : '';
	}

	/**
	 * Convert model to array
	 *
	 * @return array
	 */
	public function to_array() {
		return array(
			'id'              => $this->id,
			'user_fee_id'     => $this->user_fee_id,
			'previous_amount' => $this->previous_amount,
			'new_amount'      => $this->new_amount,
			'reason'          => $this->reason,
			'adjusted_by'     => $this->adjusted_by,
			'adjusted_at'     => $this->adjusted_at,
		);
	}

	/**
	 * Get adjustments for a user fee
	 *
	 * @param int $user_fee_id User fee ID.
	 * @return UserFeeAdjustment[]
	 */
	public static function get_by_user_fee( $user_fee_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_user_fee_adjustments';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE user_fee_id = %d ORDER BY adjusted_at DESC',
				$table_name,
				$user_fee_id
			),
			ARRAY_A
		);

		$adjustments = array();
		foreach ( $results as $result ) {
			$adjustments[] = new self( $result );
		}

		return $adjustments;
	}

	/**
	 * Save the adjustment (create only - adjustments are immutable)
	 *
	 * @return bool|int False on failure, adjustment ID on success.
	 */
	public function save() {
		global $wpdb;

		// Adjustments are immutable - only allow insert, not update
		if ( $this->id ) {
			return false;
		}

		$table_name = $wpdb->prefix . 'fair_user_fee_adjustments';
		$data       = array(
			'user_fee_id'     => $this->user_fee_id,
			'previous_amount' => $this->previous_amount,
			'new_amount'      => $this->new_amount,
			'reason'          => $this->reason,
			'adjusted_by'     => $this->adjusted_by,
		);

		$format = array( '%d', '%f', '%f', '%s', '%d' );

		$result = $wpdb->insert( $table_name, $data, $format );
		if ( $result ) {
			$this->id = $wpdb->insert_id;
			return $this->id;
		}
		return false;
	}

	/**
	 * Create an adjustment record
	 *
	 * @param int    $user_fee_id User fee ID.
	 * @param float  $previous_amount Previous amount.
	 * @param float  $new_amount New amount.
	 * @param string $reason Reason for adjustment.
	 * @param int    $adjusted_by User ID who made the adjustment.
	 * @return bool|int False on failure, adjustment ID on success.
	 */
	public static function create( $user_fee_id, $previous_amount, $new_amount, $reason, $adjusted_by = null ) {
		$adjustment                  = new self();
		$adjustment->user_fee_id     = $user_fee_id;
		$adjustment->previous_amount = $previous_amount;
		$adjustment->new_amount      = $new_amount;
		$adjustment->reason          = $reason;
		$adjustment->adjusted_by     = $adjusted_by ? $adjusted_by : get_current_user_id();

		return $adjustment->save();
	}

	/**
	 * Validate adjustment data
	 *
	 * @return bool|\WP_Error True if valid, WP_Error otherwise.
	 */
	public function validate() {
		if ( empty( $this->user_fee_id ) ) {
			return new \WP_Error( 'missing_user_fee_id', __( 'User fee ID is required.', 'fair-membership' ) );
		}

		if ( ! is_numeric( $this->previous_amount ) || $this->previous_amount < 0 ) {
			return new \WP_Error( 'invalid_previous_amount', __( 'Previous amount must be a positive number.', 'fair-membership' ) );
		}

		if ( ! is_numeric( $this->new_amount ) || $this->new_amount < 0 ) {
			return new \WP_Error( 'invalid_new_amount', __( 'New amount must be a positive number.', 'fair-membership' ) );
		}

		if ( empty( $this->reason ) ) {
			return new \WP_Error( 'missing_reason', __( 'Reason is required for audit trail.', 'fair-membership' ) );
		}

		return true;
	}
}
