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
	 * Delete a single signup row by its exact ID.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return bool True when the row was deleted.
	 */
	public static function delete( int $signup_id ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		return 1 === $wpdb->delete(
			$table,
			array( 'id' => $signup_id ),
			array( '%d' )
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
	 * Confirm a signup only while it is awaiting payment or locally expired.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return bool True when the row transitioned.
	 */
	public static function confirm_paid( int $signup_id ) {
		return self::transition_status( $signup_id, 'confirmed', array( 'pending_payment', 'expired' ) );
	}

	/**
	 * Fail a signup only while it is still awaiting payment.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return bool True when the row transitioned.
	 */
	public static function fail_pending( int $signup_id ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		return 1 === (int) $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET status = %s WHERE id = %d AND status = %s',
				$table,
				'failed',
				$signup_id,
				'pending_payment'
			)
		);
	}

	/**
	 * Atomically transition a signup from one of the allowed statuses.
	 *
	 * @param int      $signup_id     Signup row ID.
	 * @param string   $target_status New status.
	 * @param string[] $from_statuses Allowed current statuses.
	 * @return bool True when the row transitioned.
	 */
	private static function transition_status( int $signup_id, string $target_status, array $from_statuses ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';
		if ( 2 === count( $from_statuses ) ) {
			$updated = $wpdb->query(
				$wpdb->prepare(
					'UPDATE %i SET status = %s, payment_expires_at = NULL WHERE id = %d AND status IN (%s, %s)',
					$table,
					$target_status,
					$signup_id,
					$from_statuses[0],
					$from_statuses[1]
				)
			);
		} else {
			$updated = $wpdb->query(
				$wpdb->prepare(
					'UPDATE %i SET status = %s, payment_expires_at = NULL WHERE id = %d AND status = %s',
					$table,
					$target_status,
					$signup_id,
					$from_statuses[0]
				)
			);
		}

		return 1 === (int) $updated;
	}

	/**
	 * Store transaction ID and payment expiry on a signup row.
	 *
	 * @param int         $signup_id      Signup row ID.
	 * @param int         $transaction_id Transaction ID.
	 * @param string|null $status         Optional status to set atomically with the new transaction.
	 * @return bool
	 */
	public static function update_transaction( int $signup_id, int $transaction_id, ?string $status = null ) {
		global $wpdb;

		$table      = $wpdb->prefix . 'fair_events_signups';
		$expires_at = gmdate( 'Y-m-d H:i:s', time() + 15 * MINUTE_IN_SECONDS );
		$data       = array(
			'transaction_id'     => $transaction_id,
			'payment_expires_at' => $expires_at,
		);
		$formats    = array( '%d', '%s' );

		if ( null !== $status ) {
			$data['status'] = $status;
			$formats[]      = '%s';
		}

		return (bool) $wpdb->update(
			$table,
			$data,
			array( 'id' => $signup_id ),
			$formats,
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
	 * Get every signup row sharing a transaction ID. A 'multiple_instances'
	 * ticket-type purchase creates one row per chosen occurrence under a
	 * single transaction; every other purchase resolves to exactly one row.
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return object[]
	 */
	public static function get_all_by_transaction_id( int $transaction_id ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		return $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM %i WHERE transaction_id = %d ORDER BY id ASC', $table, $transaction_id )
		);
	}

	/**
	 * Resolve the signup row ID(s) tied to a fair-payments-connector
	 * transaction, from its metadata. Returns an empty array when the
	 * transaction isn't a get-tickets purchase.
	 *
	 * Promoted from PaymentHooks so the retry/cancel REST routes can resolve
	 * the same multi-row set the payment webhook confirms/fails together.
	 *
	 * @param object $transaction Transaction object.
	 * @return int[] Signup IDs (empty when none apply).
	 */
	public static function resolve_signup_ids_from_transaction( $transaction ) {
		if ( ! isset( $transaction->metadata ) ) {
			return array();
		}

		$metadata = is_string( $transaction->metadata )
			? json_decode( $transaction->metadata, true )
			: (array) $transaction->metadata;

		if ( ( $metadata['source'] ?? '' ) !== 'fair-events-get-tickets' ) {
			return array();
		}

		// 'multiple_instances' purchases store one signup row ID per chosen occurrence.
		if ( ! empty( $metadata['signup_ids'] ) && is_array( $metadata['signup_ids'] ) ) {
			$signup_ids = array_map( 'intval', $metadata['signup_ids'] );
			return array_values(
				array_filter(
					$signup_ids,
					static function ( $signup_id ) use ( $transaction ) {
						$signup = self::get_by_id( $signup_id );
						return $signup && (int) $signup->transaction_id === (int) $transaction->id;
					}
				)
			);
		}

		if ( ! empty( $metadata['signup_id'] ) ) {
			$signup = self::get_by_id( (int) $metadata['signup_id'] );
			return $signup && (int) $signup->transaction_id === (int) $transaction->id
				? array( (int) $signup->id )
				: array();
		}

		// Fall back to lookup by transaction_id.
		$signup = self::get_by_transaction_id( (int) $transaction->id );
		return $signup ? array( (int) $signup->id ) : array();
	}

	/**
	 * Cancel a pending-payment signup row: mark it failed and clear its hold,
	 * so a direct-navigation lookup (SignupPaymentSession) can't resurrect the
	 * same checkout after the visitor explicitly starts over.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return bool
	 */
	public static function cancel_pending( int $signup_id ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		return (bool) $wpdb->update(
			$table,
			array(
				'status'             => 'failed',
				'payment_expires_at' => null,
			),
			array( 'id' => $signup_id ),
			array( '%s', '%s' ),
			array( '%d' )
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
	 * Expire stale pending-payment rows without deleting reconciliation data.
	 *
	 * @return int Number of rows transitioned.
	 */
	public static function expire_pending() {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		return (int) $wpdb->query(
			$wpdb->prepare(
				"UPDATE %i SET status = 'expired', payment_expires_at = NULL WHERE status = 'pending_payment' AND payment_expires_at IS NOT NULL AND payment_expires_at <= %s",
				$table,
				gmdate( 'Y-m-d H:i:s' )
			)
		);
	}

	/**
	 * Mark a confirmed signup for administrator capacity reconciliation.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return bool
	 */
	public static function mark_over_capacity( int $signup_id ) {
		global $wpdb;

		return (bool) $wpdb->update(
			$wpdb->prefix . 'fair_events_signups',
			array( 'over_capacity' => 1 ),
			array( 'id' => $signup_id ),
			array( '%d' ),
			array( '%d' )
		);
	}

	/**
	 * Scrub signup-owned personal data linked to a participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return int Number of rows anonymized.
	 */
	public static function anonymize_by_participant_id( int $participant_id ) {
		global $wpdb;

		return (int) $wpdb->update(
			$wpdb->prefix . 'fair_events_signups',
			array(
				'name'           => '',
				'email'          => '',
				'mailing_opt_in' => 0,
				'participant_id' => null,
			),
			array( 'participant_id' => $participant_id ),
			array( '%s', '%s', '%d', '%d' ),
			array( '%d' )
		);
	}
}
