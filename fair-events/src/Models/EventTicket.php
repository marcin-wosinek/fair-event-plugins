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
 * ticket units it owns, positioned 1 through quantity. Unit status follows
 * the owning signup's status on every transition, except once a unit has
 * been cancelled or refunded on its own: that status is final for the unit
 * and is what capacity counts (see TicketCapacity).
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
	 * Get a ticket unit by ID.
	 *
	 * @param int $id Ticket ID.
	 * @return object|null
	 */
	public static function get_by_id( int $id ) {
		global $wpdb;

		return $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', self::table(), $id )
		);
	}

	/**
	 * Unit statuses that no longer admit anyone: the purchase failed or
	 * lapsed, or the unit was cancelled or refunded.
	 */
	const INACTIVE_STATUSES = array( 'failed', 'expired', 'cancelled', 'refunded' );

	/**
	 * Get the units a participant holds on an event date, oldest first,
	 * leaving out units that no longer admit anyone.
	 *
	 * @param int      $event_date_id  Event date ID.
	 * @param int      $participant_id Holder participant ID.
	 * @param string[] $statuses       Only these statuses; empty for every active status.
	 * @return object[]
	 */
	public static function get_held_on_event_date( int $event_date_id, int $participant_id, array $statuses = array() ) {
		$by_holder = self::get_held_by_participants( $event_date_id, array( $participant_id ), $statuses );

		return $by_holder[ $participant_id ] ?? array();
	}

	/**
	 * Get the active units several participants hold on an event date,
	 * grouped by holder and ordered by signup and position.
	 *
	 * @param int      $event_date_id   Event date ID.
	 * @param int[]    $participant_ids Holder participant IDs.
	 * @param string[] $statuses        Only these statuses; empty for every active status.
	 * @return array<int, object[]> Units keyed by holder participant ID.
	 */
	public static function get_held_by_participants( int $event_date_id, array $participant_ids, array $statuses = array() ) {
		global $wpdb;

		$participant_ids = array_values( array_filter( array_map( 'intval', $participant_ids ) ) );
		if ( ! $participant_ids ) {
			return array();
		}

		$holder_placeholders = implode( ', ', array_fill( 0, count( $participant_ids ), '%d' ) );
		if ( $statuses ) {
			$status_sql  = 'status IN (' . implode( ', ', array_fill( 0, count( $statuses ), '%s' ) ) . ')';
			$status_args = array_values( $statuses );
		} else {
			$status_sql  = 'status NOT IN (' . implode( ', ', array_fill( 0, count( self::INACTIVE_STATUSES ), '%s' ) ) . ')';
			$status_args = self::INACTIVE_STATUSES;
		}

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- placeholder lists built above.
		$units = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE event_date_id = %d AND holder_participant_id IN ( $holder_placeholders ) AND $status_sql ORDER BY signup_id ASC, unit_position ASC",
				array_merge( array( self::table(), $event_date_id ), $participant_ids, $status_args )
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		$by_holder = array();
		foreach ( $units as $unit ) {
			$by_holder[ (int) $unit->holder_participant_id ][] = $unit;
		}

		return $by_holder;
	}

	/**
	 * Record or clear one unit's check-in. Checking in an already checked-in
	 * unit keeps its first time; clearing sets it to null.
	 *
	 * @param int         $ticket_id Ticket ID.
	 * @param bool        $attended  Whether the holder has arrived.
	 * @param string|null $at        Site-local check-in time; now when omitted.
	 * @return bool
	 */
	public static function set_attended( int $ticket_id, bool $attended, $at = null ) {
		global $wpdb;

		if ( $attended ) {
			$result = $wpdb->query(
				$wpdb->prepare(
					'UPDATE %i SET attended_at = COALESCE(attended_at, %s) WHERE id = %d',
					self::table(),
					$at ? (string) $at : current_time( 'mysql' ),
					$ticket_id
				)
			);
		} else {
			$result = $wpdb->query(
				$wpdb->prepare( 'UPDATE %i SET attended_at = NULL WHERE id = %d', self::table(), $ticket_id )
			);
		}

		return false !== $result;
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

		// Read with a plain SELECT and delete only by primary key. A ranged
		// DELETE that matches nothing (every new signup) takes an InnoDB gap
		// lock on idx_signup_unit; two signups saved concurrently then block
		// each other's unit INSERT and one dies in a deadlock.
		$units = $wpdb->get_results(
			$wpdb->prepare( 'SELECT id, unit_position FROM %i WHERE signup_id = %d', self::table(), $signup_id )
		);

		$existing  = array();
		$stale_ids = array();
		foreach ( $units as $unit ) {
			$position = (int) $unit->unit_position;
			if ( $position < 1 || $position > $quantity ) {
				$stale_ids[] = (int) $unit->id;
			} else {
				$existing[] = $position;
			}
		}

		$removed = 0;
		if ( $stale_ids ) {
			EventTicketActivity::delete_by_ticket_ids( $stale_ids );
			$removed = (int) $wpdb->query(
				$wpdb->prepare(
					'DELETE FROM %i WHERE id IN (' . implode( ', ', array_fill( 0, count( $stale_ids ), '%d' ) ) . ')',
					array_merge( array( self::table() ), $stale_ids )
				)
			);
		}

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
	 * Unit statuses set on an individual ticket that signup transitions
	 * never overwrite.
	 */
	const FINAL_UNIT_STATUSES = array( 'cancelled', 'refunded' );

	/**
	 * Copy a signup's current status onto its ticket units, leaving units
	 * cancelled or refunded on their own untouched.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return void
	 */
	public static function sync_status_from_signup( int $signup_id ) {
		global $wpdb;

		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i AS t INNER JOIN %i AS s ON s.id = t.signup_id SET t.status = s.status WHERE t.signup_id = %d AND t.status NOT IN (%s, %s)',
				self::table(),
				$wpdb->prefix . 'fair_events_signups',
				$signup_id,
				self::FINAL_UNIT_STATUSES[0],
				self::FINAL_UNIT_STATUSES[1]
			)
		);
	}

	/**
	 * Count a signup's units that follow it on a move or type change: every
	 * unit except those cancelled or refunded on their own.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return int
	 */
	public static function count_active_units( int $signup_id ) {
		global $wpdb;

		return (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE signup_id = %d AND status NOT IN (%s, %s)',
				self::table(),
				$signup_id,
				self::FINAL_UNIT_STATUSES[0],
				self::FINAL_UNIT_STATUSES[1]
			)
		);
	}

	/**
	 * Set event_date_id or ticket_type_id on a signup's units, leaving units
	 * cancelled or refunded on their own untouched.
	 *
	 * @param int    $signup_id Signup row ID.
	 * @param string $column    'event_date_id' or 'ticket_type_id'.
	 * @param int    $value     New value.
	 * @return bool
	 */
	public static function set_active_units_column( int $signup_id, string $column, int $value ) {
		global $wpdb;

		if ( ! in_array( $column, array( 'event_date_id', 'ticket_type_id' ), true ) ) {
			return false;
		}

		return false !== $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET %i = %d WHERE signup_id = %d AND status NOT IN (%s, %s)',
				self::table(),
				$column,
				$value,
				$signup_id,
				self::FINAL_UNIT_STATUSES[0],
				self::FINAL_UNIT_STATUSES[1]
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

		EventTicketActivity::delete_by_ticket_ids(
			array_map( 'intval', wp_list_pluck( self::get_by_signup_id( $signup_id ), 'id' ) )
		);

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
