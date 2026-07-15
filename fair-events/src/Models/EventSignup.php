<?php
/**
 * Event Signup Model
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Model for the fair_events_signups table.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventSignup {

	/**
	 * Save a signup row and return its ID.
	 *
	 * @param array $data Keys: event_date_id, ticket_type_id, name, email, quantity, mailing_opt_in, amount, status, participant_id.
	 * @return int|false Inserted ID or false on failure.
	 */
	public static function save( array $data ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		$inserted = $wpdb->insert(
			$table,
			array(
				'event_date_id'  => (int) ( $data['event_date_id'] ?? 0 ),
				'ticket_type_id' => isset( $data['ticket_type_id'] ) && $data['ticket_type_id'] ? (int) $data['ticket_type_id'] : null,
				'name'           => $data['name'] ?? '',
				'email'          => $data['email'] ?? '',
				'quantity'       => max( 1, (int) ( $data['quantity'] ?? 1 ) ),
				'mailing_opt_in' => (int) ( $data['mailing_opt_in'] ?? 0 ),
				'amount'         => (float) ( $data['amount'] ?? 0.00 ),
				'status'         => $data['status'] ?? 'confirmed',
				'participant_id' => isset( $data['participant_id'] ) && $data['participant_id'] ? (int) $data['participant_id'] : null,
				'created_at'     => current_time( 'mysql' ),
			),
			array( '%d', '%d', '%s', '%s', '%d', '%d', '%f', '%s', '%d', '%s' )
		);

		if ( ! $inserted ) {
			return false;
		}

		return (int) $wpdb->insert_id;
	}

	/**
	 * Get a signup row by ID.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return object|null
	 */
	public static function get_by_id( int $signup_id ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		return $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', $table, $signup_id )
		);
	}

	/**
	 * Link a signup row to a fair-audience Participant.
	 *
	 * @param int $signup_id      Signup row ID.
	 * @param int $participant_id Participant ID.
	 * @return bool
	 */
	public static function update_participant( int $signup_id, int $participant_id ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		return (bool) $wpdb->update(
			$table,
			array( 'participant_id' => $participant_id ),
			array( 'id' => $signup_id ),
			array( '%d' ),
			array( '%d' )
		);
	}

	/**
	 * Whether a participant already holds a confirmed signup on an event date.
	 *
	 * Recurring series save "all series" tickets on the master event date, so
	 * one person can legitimately have multiple signups on the same
	 * event_date. Used to guard capacity-release cleanups (e.g. fair-audience's
	 * pending_payment expiry cron) against dropping a still-valid
	 * relationship when a later signup on the same date already confirmed.
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return bool
	 */
	public static function has_confirmed_signup( int $event_date_id, int $participant_id ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		$count = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i WHERE event_date_id = %d AND participant_id = %d AND status = 'confirmed'",
				$table,
				$event_date_id,
				$participant_id
			)
		);

		return $count > 0;
	}

	/**
	 * Update signup status.
	 *
	 * @param int    $signup_id Signup row ID.
	 * @param string $status    New status.
	 * @return bool
	 */
	public static function update_status( int $signup_id, string $status ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		return (bool) $wpdb->update(
			$table,
			array( 'status' => $status ),
			array( 'id' => $signup_id ),
			array( '%s' ),
			array( '%d' )
		);
	}

	/**
	 * Store transaction ID and payment expiry on a signup row.
	 *
	 * @param int $signup_id      Signup row ID.
	 * @param int $transaction_id Transaction ID.
	 * @return bool
	 */
	public static function update_transaction( int $signup_id, int $transaction_id ) {
		global $wpdb;

		$table      = $wpdb->prefix . 'fair_events_signups';
		$expires_at = gmdate( 'Y-m-d H:i:s', time() + 15 * MINUTE_IN_SECONDS );

		return (bool) $wpdb->update(
			$table,
			array(
				'transaction_id'     => $transaction_id,
				'payment_expires_at' => $expires_at,
			),
			array( 'id' => $signup_id ),
			array( '%d', '%s' ),
			array( '%d' )
		);
	}

	/**
	 * Get a signup row by transaction ID.
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return object|null
	 */
	public static function get_by_transaction_id( int $transaction_id ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		return $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE transaction_id = %d', $table, $transaction_id )
		);
	}

	/**
	 * Get all signups for an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array
	 */
	public static function get_all_by_event_date_id( int $event_date_id ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d ORDER BY created_at DESC',
				$table,
				$event_date_id
			)
		);
	}

	/**
	 * Delete stale pending_payment rows past their expiry.
	 *
	 * @return int Number of rows deleted.
	 */
	public static function delete_expired_pending() {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		return (int) $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM %i WHERE status = 'pending_payment' AND payment_expires_at IS NOT NULL AND payment_expires_at < %s",
				$table,
				current_time( 'mysql' )
			)
		);
	}
}
