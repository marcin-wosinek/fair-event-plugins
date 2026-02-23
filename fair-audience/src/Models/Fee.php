<?php
/**
 * Fee Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Fee model.
 */
class Fee {

	/**
	 * Fee ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Fee name.
	 *
	 * @var string
	 */
	public $name;

	/**
	 * Fee description.
	 *
	 * @var string
	 */
	public $description;

	/**
	 * Group ID.
	 *
	 * @var int
	 */
	public $group_id;

	/**
	 * Amount.
	 *
	 * @var string
	 */
	public $amount;

	/**
	 * Currency.
	 *
	 * @var string
	 */
	public $currency;

	/**
	 * Due date.
	 *
	 * @var string
	 */
	public $due_date;

	/**
	 * Status.
	 *
	 * @var string
	 */
	public $status;

	/**
	 * Created by user ID.
	 *
	 * @var int
	 */
	public $created_by;

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
		$this->id          = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->name        = isset( $data['name'] ) ? sanitize_text_field( $data['name'] ) : '';
		$this->description = isset( $data['description'] ) ? sanitize_textarea_field( $data['description'] ) : '';
		$this->group_id    = isset( $data['group_id'] ) ? (int) $data['group_id'] : 0;
		$this->amount      = isset( $data['amount'] ) ? $data['amount'] : '0.00';
		$this->currency    = isset( $data['currency'] ) ? sanitize_text_field( $data['currency'] ) : 'EUR';
		$this->due_date    = isset( $data['due_date'] ) ? sanitize_text_field( $data['due_date'] ) : '';
		$this->status      = isset( $data['status'] ) ? sanitize_text_field( $data['status'] ) : 'draft';
		$this->created_by  = isset( $data['created_by'] ) ? (int) $data['created_by'] : 0;
		$this->created_at  = isset( $data['created_at'] ) ? $data['created_at'] : '';
		$this->updated_at  = isset( $data['updated_at'] ) ? $data['updated_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_fees';

		// Validate required fields.
		if ( empty( $this->name ) || empty( $this->group_id ) ) {
			return false;
		}

		$data = array(
			'name'        => $this->name,
			'description' => $this->description,
			'group_id'    => $this->group_id,
			'amount'      => $this->amount,
			'currency'    => $this->currency,
			'due_date'    => ! empty( $this->due_date ) ? $this->due_date : null,
			'status'      => $this->status,
		);

		$format = array( '%s', '%s', '%d', '%f', '%s', '%s', '%s' );

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
			$data['created_by'] = ! empty( $this->created_by ) ? $this->created_by : get_current_user_id();
			$format[]           = '%d';

			$result = $wpdb->insert( $table_name, $data, $format );
			if ( $result ) {
				$this->id = $wpdb->insert_id;
			}
		}

		return false !== $result;
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

		$table_name      = $wpdb->prefix . 'fair_audience_fees';
		$payments_table  = $wpdb->prefix . 'fair_audience_fee_payments';
		$audit_log_table = $wpdb->prefix . 'fair_audience_fee_audit_log';

		// Delete audit log entries for all payments of this fee.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			$wpdb->prepare(
				'DELETE al FROM %i al INNER JOIN %i fp ON al.fee_payment_id = fp.id WHERE fp.fee_id = %d',
				$audit_log_table,
				$payments_table,
				$this->id
			)
		);

		// Delete all fee payments.
		$wpdb->delete(
			$payments_table,
			array( 'fee_id' => $this->id ),
			array( '%d' )
		);

		// Delete the fee.
		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
