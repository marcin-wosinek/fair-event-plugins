<?php
/**
 * Fee Payment Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\FeePayment;

defined( 'WPINC' ) || die;

/**
 * Repository for fee payment data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class FeePaymentRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_fee_payments';
	}

	/**
	 * Get payments for a fee with participant details.
	 *
	 * @param int $fee_id Fee ID.
	 * @return array Array of payment data with participant details.
	 */
	public function get_by_fee_with_participant_details( $fee_id ) {
		global $wpdb;

		$table_name         = $this->get_table_name();
		$participants_table = $wpdb->prefix . 'fair_audience_participants';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT fp.*, p.name as participant_name, p.surname as participant_surname, p.email as participant_email
				FROM %i fp
				LEFT JOIN %i p ON fp.participant_id = p.id
				WHERE fp.fee_id = %d
				ORDER BY p.surname ASC, p.name ASC',
				$table_name,
				$participants_table,
				$fee_id
			),
			ARRAY_A
		);

		return $results;
	}

	/**
	 * Get payment by ID.
	 *
	 * @param int $id Payment ID.
	 * @return FeePayment|null Payment or null.
	 */
	public function get_by_id( $id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d',
				$table_name,
				$id
			),
			ARRAY_A
		);

		return $result ? new FeePayment( $result ) : null;
	}

	/**
	 * Get payment by fee and participant.
	 *
	 * @param int $fee_id         Fee ID.
	 * @param int $participant_id Participant ID.
	 * @return FeePayment|null Payment or null.
	 */
	public function get_by_fee_and_participant( $fee_id, $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE fee_id = %d AND participant_id = %d',
				$table_name,
				$fee_id,
				$participant_id
			),
			ARRAY_A
		);

		return $result ? new FeePayment( $result ) : null;
	}

	/**
	 * Create payment records for all members of a group.
	 *
	 * @param int    $fee_id   Fee ID.
	 * @param int    $group_id Group ID.
	 * @param string $amount   Amount for each payment.
	 * @return int Number of payments created.
	 */
	public function create_payments_for_group( $fee_id, $group_id, $amount ) {
		global $wpdb;

		$table_name               = $this->get_table_name();
		$group_participants_table = $wpdb->prefix . 'fair_audience_group_participants';

		// Get all participants in the group.
		$members = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT participant_id FROM %i WHERE group_id = %d',
				$group_participants_table,
				$group_id
			),
			ARRAY_A
		);

		$created = 0;

		foreach ( $members as $member ) {
			// Skip if payment already exists.
			$existing = $this->get_by_fee_and_participant( $fee_id, $member['participant_id'] );
			if ( $existing ) {
				continue;
			}

			$payment = new FeePayment();
			$payment->populate(
				array(
					'fee_id'         => $fee_id,
					'participant_id' => $member['participant_id'],
					'amount'         => $amount,
					'status'         => 'pending',
				)
			);

			if ( $payment->save() ) {
				++$created;
			}
		}

		return $created;
	}

	/**
	 * Get pending payments for a fee.
	 *
	 * @param int $fee_id Fee ID.
	 * @return FeePayment[] Array of pending payments.
	 */
	public function get_pending_by_fee( $fee_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE fee_id = %d AND status = 'pending'",
				$table_name,
				$fee_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new FeePayment( $row );
			},
			$results
		);
	}
}
