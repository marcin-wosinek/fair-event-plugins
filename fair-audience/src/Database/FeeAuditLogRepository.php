<?php
/**
 * Fee Audit Log Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\FeeAuditLog;

defined( 'WPINC' ) || die;

/**
 * Repository for fee audit log data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class FeeAuditLogRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_fee_audit_log';
	}

	/**
	 * Get audit log entries for a specific fee payment.
	 *
	 * @param int $fee_payment_id Fee payment ID.
	 * @return array Array of audit log entries with user display name.
	 */
	public function get_by_fee_payment_id( $fee_payment_id ) {
		global $wpdb;

		$table_name  = $this->get_table_name();
		$users_table = $wpdb->users;

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT al.*, u.display_name as performed_by_name
				FROM %i al
				LEFT JOIN %i u ON al.performed_by = u.ID
				WHERE al.fee_payment_id = %d
				ORDER BY al.created_at DESC',
				$table_name,
				$users_table,
				$fee_payment_id
			),
			ARRAY_A
		);

		return $results;
	}

	/**
	 * Get audit log entries for all payments of a fee.
	 *
	 * @param int $fee_id Fee ID.
	 * @return array Array of audit log entries with participant and user details.
	 */
	public function get_by_fee_id( $fee_id ) {
		global $wpdb;

		$table_name         = $this->get_table_name();
		$payments_table     = $wpdb->prefix . 'fair_audience_fee_payments';
		$participants_table = $wpdb->prefix . 'fair_audience_participants';
		$users_table        = $wpdb->users;

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT al.*, u.display_name as performed_by_name,
					p.name as participant_name, p.surname as participant_surname
				FROM %i al
				INNER JOIN %i fp ON al.fee_payment_id = fp.id
				LEFT JOIN %i p ON fp.participant_id = p.id
				LEFT JOIN %i u ON al.performed_by = u.ID
				WHERE fp.fee_id = %d
				ORDER BY al.created_at DESC',
				$table_name,
				$payments_table,
				$participants_table,
				$users_table,
				$fee_id
			),
			ARRAY_A
		);

		return $results;
	}

	/**
	 * Log an action on a fee payment.
	 *
	 * @param int         $fee_payment_id Fee payment ID.
	 * @param string      $action         Action type.
	 * @param string|null $old_value      Old value.
	 * @param string|null $new_value      New value.
	 * @param string|null $comment        Comment.
	 * @return bool Success.
	 */
	public function log_action( $fee_payment_id, $action, $old_value = null, $new_value = null, $comment = null ) {
		$log = new FeeAuditLog();
		$log->populate(
			array(
				'fee_payment_id' => $fee_payment_id,
				'action'         => $action,
				'old_value'      => $old_value,
				'new_value'      => $new_value,
				'comment'        => $comment,
			)
		);

		return $log->save();
	}
}
