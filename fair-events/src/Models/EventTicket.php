<?php
/**
 * Event Ticket Model
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Model for the fair_events_tickets table: one row per individual admission.
 *
 * A signup is the purchase/payment record; its quantity determines how many
 * ticket units it owns, positioned 1 through quantity. Unit status currently
 * mirrors the owning signup's status on every transition.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventTicket {

	/**
	 * Get the ticket table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_events_tickets';
	}

	/**
	 * Generate an unguessable public reference for a ticket.
	 *
	 * @return string 32 lowercase hex characters.
	 */
	public static function generate_reference() {
		return bin2hex( random_bytes( 16 ) );
	}

	/**
	 * Get every ticket unit owned by a signup, ordered by position.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return object[]
	 */
	public static function get_by_signup_id( int $signup_id ) {
		global $wpdb;

		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE signup_id = %d ORDER BY unit_position ASC',
				self::table(),
				$signup_id
			)
		);
	}

	/**
	 * Get a ticket unit by its public reference.
	 *
	 * @param string $reference Public reference.
	 * @return object|null
	 */
	public static function get_by_reference( string $reference ) {
		global $wpdb;

		return $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE reference = %s', self::table(), $reference )
		);
	}

	/**
	 * Bring a signup's ticket units in line with its quantity: create any
	 * missing position and remove positions beyond the quantity. Safe to
	 * repeat and to run concurrently — the (signup_id, unit_position) unique
	 * key turns a duplicate insert into a no-op.
	 *
	 * @param object $signup Signup row (id, quantity, event_date_id, ticket_type_id, status, participant_id).
	 * @return array{created: int, removed: int}|false Counts, or false when a unit could not be written.
	 */
	public static function reconcile_signup( $signup ) {
		global $wpdb;

		$signup_id = (int) $signup->id;
		$quantity  = max( 1, (int) $signup->quantity );

		$removed = (int) $wpdb->query(
			$wpdb->prepare(
				'DELETE FROM %i WHERE signup_id = %d AND (unit_position < 1 OR unit_position > %d)',
				self::table(),
				$signup_id,
				$quantity
			)
		);

		$existing = array_map(
			'intval',
			$wpdb->get_col(
				$wpdb->prepare( 'SELECT unit_position FROM %i WHERE signup_id = %d', self::table(), $signup_id )
			)
		);

		$participant_id = ! empty( $signup->participant_id ) ? (int) $signup->participant_id : null;
		$created        = 0;

		for ( $position = 1; $position <= $quantity; $position++ ) {
			if ( in_array( $position, $existing, true ) ) {
				continue;
			}

			$inserted = $wpdb->query(
				$wpdb->prepare(
					'INSERT IGNORE INTO %i (reference, signup_id, unit_position, event_date_id, ticket_type_id, status, purchaser_participant_id, holder_participant_id, created_at) VALUES (%s, %d, %d, %d, NULLIF(%d, 0), %s, NULLIF(%d, 0), NULLIF(%d, 0), %s)',
					self::table(),
					self::generate_reference(),
					$signup_id,
					$position,
					(int) $signup->event_date_id,
					(int) ( $signup->ticket_type_id ?? 0 ),
					(string) ( $signup->status ?? 'confirmed' ),
					(int) $participant_id,
					(int) $participant_id,
					current_time( 'mysql' )
				)
			);

			if ( false === $inserted ) {
				return false;
			}
			$created += (int) $inserted;
		}

		// A concurrent writer may have filled a position this call skipped as
		// a duplicate; only a still-short count is a failure.
		$count = (int) $wpdb->get_var(
			$wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE signup_id = %d', self::table(), $signup_id )
		);
		if ( $count !== $quantity ) {
			return false;
		}

		return array(
			'created' => $created,
			'removed' => $removed,
		);
	}

	/**
	 * Copy a signup's current status onto all of its ticket units.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return void
	 */
	public static function sync_status_from_signup( int $signup_id ) {
		global $wpdb;

		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i AS t INNER JOIN %i AS s ON s.id = t.signup_id SET t.status = s.status WHERE t.signup_id = %d',
				self::table(),
				$wpdb->prefix . 'fair_events_signups',
				$signup_id
			)
		);
	}

	/**
	 * Copy expiry onto units whose signups were expired in bulk.
	 *
	 * @return void
	 */
	public static function sync_expired_signups() {
		global $wpdb;

		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i AS t INNER JOIN %i AS s ON s.id = t.signup_id SET t.status = s.status WHERE t.status = %s AND s.status = %s',
				self::table(),
				$wpdb->prefix . 'fair_events_signups',
				'pending_payment',
				'expired'
			)
		);
	}

	/**
	 * Link a signup's units to its purchaser. The holder follows the
	 * purchaser until the unit has been given to someone else.
	 *
	 * @param int $signup_id      Signup row ID.
	 * @param int $participant_id Purchaser participant ID.
	 * @return void
	 */
	public static function link_purchaser( int $signup_id, int $participant_id ) {
		global $wpdb;

		// Single-table UPDATE assigns left to right, so the holder check
		// reads the purchaser value from before this statement.
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET holder_participant_id = CASE WHEN holder_participant_id IS NULL OR holder_participant_id = purchaser_participant_id THEN %d ELSE holder_participant_id END, purchaser_participant_id = %d WHERE signup_id = %d',
				self::table(),
				$participant_id,
				$participant_id,
				$signup_id
			)
		);
	}

	/**
	 * Link unlinked units to participants their signups were matched to
	 * later (e.g. fair-audience's email backfill). Never creates units.
	 *
	 * @return void
	 */
	public static function sync_participants_from_signups() {
		global $wpdb;

		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i AS t INNER JOIN %i AS s ON s.id = t.signup_id SET t.holder_participant_id = COALESCE(t.holder_participant_id, s.participant_id), t.purchaser_participant_id = s.participant_id WHERE t.purchaser_participant_id IS NULL AND s.participant_id IS NOT NULL',
				self::table(),
				$wpdb->prefix . 'fair_events_signups'
			)
		);
	}

	/**
	 * Drop a deleted participant's links while keeping the units as
	 * non-personal purchase history.
	 *
	 * @param int $participant_id Participant ID.
	 * @return void
	 */
	public static function anonymize_participant( int $participant_id ) {
		global $wpdb;

		foreach ( array( 'purchaser_participant_id', 'holder_participant_id' ) as $column ) {
			$wpdb->query(
				$wpdb->prepare(
					'UPDATE %i SET %i = NULL WHERE %i = %d',
					self::table(),
					$column,
					$column,
					$participant_id
				)
			);
		}
	}

	/**
	 * Delete every unit owned by a signup.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return int|false Deleted row count, or false on error.
	 */
	public static function delete_by_signup_id( int $signup_id ) {
		global $wpdb;

		return $wpdb->query(
			$wpdb->prepare( 'DELETE FROM %i WHERE signup_id = %d', self::table(), $signup_id )
		);
	}

	/**
	 * Signups owning fewer units than their quantity.
	 *
	 * @param int $limit Maximum IDs to return.
	 * @return int[]
	 */
	public static function find_signups_missing_units( int $limit = 100 ) {
		global $wpdb;

		return array_map(
			'intval',
			$wpdb->get_col(
				$wpdb->prepare(
					'SELECT s.id FROM %i AS s LEFT JOIN %i AS t ON t.signup_id = s.id AND t.unit_position BETWEEN 1 AND GREATEST(s.quantity, 1) GROUP BY s.id, s.quantity HAVING COUNT(t.id) < GREATEST(s.quantity, 1) ORDER BY s.id ASC LIMIT %d',
					$wpdb->prefix . 'fair_events_signups',
					self::table(),
					$limit
				)
			)
		);
	}

	/**
	 * Signup IDs referenced by units that exceed their signup's quantity or
	 * whose signup no longer exists.
	 *
	 * @param int $limit Maximum IDs to return.
	 * @return int[]
	 */
	public static function find_signups_with_excess_units( int $limit = 100 ) {
		global $wpdb;

		return array_map(
			'intval',
			$wpdb->get_col(
				$wpdb->prepare(
					'SELECT DISTINCT t.signup_id FROM %i AS t LEFT JOIN %i AS s ON s.id = t.signup_id WHERE s.id IS NULL OR t.unit_position < 1 OR t.unit_position > GREATEST(s.quantity, 1) ORDER BY t.signup_id ASC LIMIT %d',
					self::table(),
					$wpdb->prefix . 'fair_events_signups',
					$limit
				)
			)
		);
	}
}
