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
	 * How long a paid reservation holds its places while payment is in flight.
	 */
	const PAYMENT_HOLD_SECONDS = 900;

	/**
	 * Save a signup row together with one ticket unit per admission and
	 * return its ID. The signup and its units are written atomically.
	 *
	 * @param array $data Keys: event_date_id, ticket_type_id, name, email, quantity, mailing_opt_in, amount, status, participant_id.
	 * @return int|false Inserted ID or false on failure.
	 */
	public static function save( array $data ) {
		global $wpdb;

		$wpdb->query( 'START TRANSACTION' );

		$signup_id = self::save_in_transaction( $data );

		if ( $signup_id ) {
			$wpdb->query( 'COMMIT' );
		} else {
			$wpdb->query( 'ROLLBACK' );
		}

		return $signup_id;
	}

	/**
	 * Save a signup row and its ticket units inside a transaction the caller
	 * already opened (e.g. TicketCapacity::reserve()), without starting a
	 * nested one — MySQL would silently commit the outer transaction. The
	 * caller rolls back when this returns false.
	 *
	 * A pending_payment signup is saved with its payment hold already
	 * running, so its places are reserved from the moment it exists.
	 *
	 * @param array $data See save().
	 * @return int|false Inserted ID or false on failure.
	 */
	public static function save_in_transaction( array $data ) {
		global $wpdb;

		$status = $data['status'] ?? 'confirmed';

		$inserted = $wpdb->insert(
			$wpdb->prefix . 'fair_events_signups',
			array(
				'event_date_id'      => (int) ( $data['event_date_id'] ?? 0 ),
				'ticket_type_id'     => isset( $data['ticket_type_id'] ) && $data['ticket_type_id'] ? (int) $data['ticket_type_id'] : null,
				'name'               => $data['name'] ?? '',
				'email'              => $data['email'] ?? '',
				'quantity'           => max( 1, (int) ( $data['quantity'] ?? 1 ) ),
				'mailing_opt_in'     => (int) ( $data['mailing_opt_in'] ?? 0 ),
				'amount'             => (float) ( $data['amount'] ?? 0.00 ),
				'status'             => $status,
				'participant_id'     => isset( $data['participant_id'] ) && $data['participant_id'] ? (int) $data['participant_id'] : null,
				'payment_expires_at' => 'pending_payment' === $status ? self::new_hold_expiry() : null,
				'created_at'         => current_time( 'mysql' ),
			),
			array( '%d', '%d', '%s', '%s', '%d', '%d', '%f', '%s', '%d', '%s', '%s' )
		);

		if ( ! $inserted ) {
			return false;
		}

		$signup_id = (int) $wpdb->insert_id;
		$signup    = self::get_by_id( $signup_id );

		if ( ! $signup || false === EventTicket::reconcile_signup( $signup ) ) {
			return false;
		}

		return $signup_id;
	}

	/**
	 * Expiry (UTC) of a payment hold starting now.
	 *
	 * @return string
	 */
	private static function new_hold_expiry() {
		return gmdate( 'Y-m-d H:i:s', time() + self::PAYMENT_HOLD_SECONDS );
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

		$wpdb->query( 'START TRANSACTION' );

		$deleted = 1 === $wpdb->delete(
			$table,
			array( 'id' => $signup_id ),
			array( '%d' )
		);

		if ( ! $deleted
			|| false === EventTicket::delete_by_signup_id( $signup_id )
			|| false === EventCapacityOverride::delete_by_signup_id( $signup_id )
		) {
			$wpdb->query( 'ROLLBACK' );
			return false;
		}

		$wpdb->query( 'COMMIT' );

		return true;
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

		$updated = (bool) $wpdb->update(
			$table,
			array( 'participant_id' => $participant_id ),
			array( 'id' => $signup_id ),
			array( '%d' ),
			array( '%d' )
		);

		EventTicket::link_purchaser( $signup_id, $participant_id );

		return $updated;
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
	 * Whether a participant holds an active signup on an event date other
	 * than the one given: confirmed, or awaiting payment within a running
	 * hold.
	 *
	 * @param int $event_date_id     Event date ID.
	 * @param int $participant_id    Participant ID.
	 * @param int $exclude_signup_id Signup row ID to leave out.
	 * @return bool
	 */
	public static function has_other_active_signup( int $event_date_id, int $participant_id, int $exclude_signup_id ) {
		global $wpdb;

		$count = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i WHERE event_date_id = %d AND participant_id = %d AND id <> %d
				AND ( status = 'confirmed' OR ( status = 'pending_payment' AND payment_expires_at > %s ) )",
				$wpdb->prefix . 'fair_events_signups',
				$event_date_id,
				$participant_id,
				$exclude_signup_id,
				gmdate( 'Y-m-d H:i:s' )
			)
		);

		return $count > 0;
	}

	/**
	 * Move a signup and its ticket units to another event date, inside a
	 * transaction the caller already opened. Units cancelled or refunded on
	 * their own stay where they are.
	 *
	 * @param int $signup_id     Signup row ID.
	 * @param int $event_date_id Target event date ID.
	 * @return bool
	 */
	public static function move_in_transaction( int $signup_id, int $event_date_id ) {
		return self::set_placement( $signup_id, 'event_date_id', $event_date_id );
	}

	/**
	 * Give a signup and its ticket units another ticket type, inside a
	 * transaction the caller already opened. Units cancelled or refunded on
	 * their own keep their type.
	 *
	 * @param int $signup_id      Signup row ID.
	 * @param int $ticket_type_id Target ticket type ID.
	 * @return bool
	 */
	public static function change_ticket_type_in_transaction( int $signup_id, int $ticket_type_id ) {
		return self::set_placement( $signup_id, 'ticket_type_id', $ticket_type_id );
	}

	/**
	 * Set event_date_id or ticket_type_id on a signup and its active units.
	 *
	 * @param int    $signup_id Signup row ID.
	 * @param string $column    'event_date_id' or 'ticket_type_id'.
	 * @param int    $value     New value.
	 * @return bool
	 */
	private static function set_placement( int $signup_id, string $column, int $value ) {
		global $wpdb;

		$updated = $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET %i = %d WHERE id = %d',
				$wpdb->prefix . 'fair_events_signups',
				$column,
				$value,
				$signup_id
			)
		);

		return false !== $updated && EventTicket::set_active_units_column( $signup_id, $column, $value );
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

		$updated = (bool) $wpdb->update(
			$table,
			array( 'status' => $status ),
			array( 'id' => $signup_id ),
			array( '%s' ),
			array( '%d' )
		);

		if ( $updated ) {
			EventTicket::sync_status_from_signup( $signup_id );
		}

		return $updated;
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

		$failed = 1 === (int) $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET status = %s WHERE id = %d AND status = %s',
				$table,
				'failed',
				$signup_id,
				'pending_payment'
			)
		);

		if ( $failed ) {
			EventTicket::sync_status_from_signup( $signup_id );
		}

		return $failed;
	}

	/**
	 * Start a fresh payment hold on a signup whose previous hold was released
	 * (a failed payment being retried). Callers recheck capacity first — see
	 * TicketCapacity::reserve().
	 *
	 * @param int $signup_id Signup row ID.
	 * @return bool True when the row now holds its places again.
	 */
	public static function renew_hold( int $signup_id ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_events_signups';

		$renewed = 1 === (int) $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET status = %s, payment_expires_at = %s WHERE id = %d AND status IN (%s, %s, %s)',
				$table,
				'pending_payment',
				self::new_hold_expiry(),
				$signup_id,
				'pending_payment',
				'failed',
				'expired'
			)
		);

		if ( $renewed ) {
			EventTicket::sync_status_from_signup( $signup_id );
		}

		return $renewed;
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

		$transitioned = 1 === (int) $updated;
		if ( $transitioned ) {
			EventTicket::sync_status_from_signup( $signup_id );
		}

		return $transitioned;
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

		$table   = $wpdb->prefix . 'fair_events_signups';
		$data    = array(
			'transaction_id'     => $transaction_id,
			'payment_expires_at' => self::new_hold_expiry(),
		);
		$formats = array( '%d', '%s' );

		if ( null !== $status ) {
			$data['status'] = $status;
			$formats[]      = '%s';
		}

		$updated = (bool) $wpdb->update(
			$table,
			$data,
			array( 'id' => $signup_id ),
			$formats,
			array( '%d' )
		);

		if ( $updated && null !== $status ) {
			EventTicket::sync_status_from_signup( $signup_id );
		}

		return $updated;
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

		$cancelled = (bool) $wpdb->update(
			$table,
			array(
				'status'             => 'failed',
				'payment_expires_at' => null,
			),
			array(
				'id'     => $signup_id,
				'status' => 'pending_payment',
			),
			array( '%s', '%s' ),
			array( '%d', '%s' )
		);

		if ( $cancelled ) {
			EventTicket::sync_status_from_signup( $signup_id );
		}

		return $cancelled;
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

		$expired = (int) $wpdb->query(
			$wpdb->prepare(
				"UPDATE %i SET status = 'expired', payment_expires_at = NULL WHERE status = 'pending_payment' AND payment_expires_at IS NOT NULL AND payment_expires_at <= %s",
				$table,
				gmdate( 'Y-m-d H:i:s' )
			)
		);

		if ( $expired > 0 ) {
			EventTicket::sync_expired_signups();
		}

		return $expired;
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

		EventTicket::anonymize_participant( $participant_id );

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
