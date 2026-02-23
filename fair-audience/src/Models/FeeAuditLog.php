<?php
/**
 * Fee Audit Log Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Fee audit log model (insert-only).
 */
class FeeAuditLog {

	/**
	 * Log entry ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Fee payment ID.
	 *
	 * @var int
	 */
	public $fee_payment_id;

	/**
	 * Action type.
	 *
	 * @var string
	 */
	public $action;

	/**
	 * Old value.
	 *
	 * @var string|null
	 */
	public $old_value;

	/**
	 * New value.
	 *
	 * @var string|null
	 */
	public $new_value;

	/**
	 * Comment.
	 *
	 * @var string|null
	 */
	public $comment;

	/**
	 * Performed by user ID.
	 *
	 * @var int
	 */
	public $performed_by;

	/**
	 * Created timestamp.
	 *
	 * @var string
	 */
	public $created_at;

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
		$this->id             = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->fee_payment_id = isset( $data['fee_payment_id'] ) ? (int) $data['fee_payment_id'] : 0;
		$this->action         = isset( $data['action'] ) ? sanitize_text_field( $data['action'] ) : '';
		$this->old_value      = isset( $data['old_value'] ) ? sanitize_text_field( $data['old_value'] ) : null;
		$this->new_value      = isset( $data['new_value'] ) ? sanitize_text_field( $data['new_value'] ) : null;
		$this->comment        = isset( $data['comment'] ) ? sanitize_textarea_field( $data['comment'] ) : null;
		$this->performed_by   = isset( $data['performed_by'] ) ? (int) $data['performed_by'] : 0;
		$this->created_at     = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database (insert only).
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_fee_audit_log';

		// Audit log is insert-only.
		if ( $this->id ) {
			return false;
		}

		// Validate required fields.
		if ( empty( $this->fee_payment_id ) || empty( $this->action ) ) {
			return false;
		}

		// Auto-set performed_by from current user if not set.
		if ( empty( $this->performed_by ) ) {
			$this->performed_by = get_current_user_id();
		}

		$data = array(
			'fee_payment_id' => $this->fee_payment_id,
			'action'         => $this->action,
			'old_value'      => $this->old_value,
			'new_value'      => $this->new_value,
			'comment'        => $this->comment,
			'performed_by'   => $this->performed_by,
		);

		$format = array( '%d', '%s', '%s', '%s', '%s', '%d' );

		$result = $wpdb->insert( $table_name, $data, $format );
		if ( $result ) {
			$this->id = $wpdb->insert_id;
		}

		return false !== $result;
	}
}
