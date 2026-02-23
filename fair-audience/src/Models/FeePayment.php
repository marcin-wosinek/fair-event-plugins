<?php
/**
 * Fee Payment Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Fee payment model.
 */
class FeePayment {

	/**
	 * Payment ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Fee ID.
	 *
	 * @var int
	 */
	public $fee_id;

	/**
	 * Participant ID.
	 *
	 * @var int
	 */
	public $participant_id;

	/**
	 * Amount.
	 *
	 * @var string
	 */
	public $amount;

	/**
	 * Status.
	 *
	 * @var string
	 */
	public $status;

	/**
	 * Transaction ID (for future online payments).
	 *
	 * @var int|null
	 */
	public $transaction_id;

	/**
	 * Paid at timestamp.
	 *
	 * @var string|null
	 */
	public $paid_at;

	/**
	 * Reminder sent at timestamp.
	 *
	 * @var string|null
	 */
	public $reminder_sent_at;

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
		$this->id               = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->fee_id           = isset( $data['fee_id'] ) ? (int) $data['fee_id'] : 0;
		$this->participant_id   = isset( $data['participant_id'] ) ? (int) $data['participant_id'] : 0;
		$this->amount           = isset( $data['amount'] ) ? $data['amount'] : '0.00';
		$this->status           = isset( $data['status'] ) ? sanitize_text_field( $data['status'] ) : 'pending';
		$this->transaction_id   = isset( $data['transaction_id'] ) ? (int) $data['transaction_id'] : null;
		$this->paid_at          = isset( $data['paid_at'] ) ? $data['paid_at'] : null;
		$this->reminder_sent_at = isset( $data['reminder_sent_at'] ) ? $data['reminder_sent_at'] : null;
		$this->created_at       = isset( $data['created_at'] ) ? $data['created_at'] : '';
		$this->updated_at       = isset( $data['updated_at'] ) ? $data['updated_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_fee_payments';

		// Validate required fields.
		if ( empty( $this->fee_id ) || empty( $this->participant_id ) ) {
			return false;
		}

		$data = array(
			'fee_id'           => $this->fee_id,
			'participant_id'   => $this->participant_id,
			'amount'           => $this->amount,
			'status'           => $this->status,
			'transaction_id'   => $this->transaction_id,
			'paid_at'          => $this->paid_at,
			'reminder_sent_at' => $this->reminder_sent_at,
		);

		$format = array( '%d', '%d', '%f', '%s', '%d', '%s', '%s' );

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

		$table_name      = $wpdb->prefix . 'fair_audience_fee_payments';
		$audit_log_table = $wpdb->prefix . 'fair_audience_fee_audit_log';

		// Delete audit log entries for this payment.
		$wpdb->delete(
			$audit_log_table,
			array( 'fee_payment_id' => $this->id ),
			array( '%d' )
		);

		// Delete the payment.
		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
