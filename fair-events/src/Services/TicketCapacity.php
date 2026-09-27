<?php
/**
 * Ticket Capacity Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Helpers\DateRangeFormatter;
use FairEvents\Models\EventDates;
use FairEvents\Models\TicketType;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Single authority for how many places an event date or a ticket type has
 * taken, counted from individual ticket units (#1532). Purchase validation,
 * late payment confirmation, retries, and the ticket-type `has_sales` guard
 * all resolve this same count.
 *
 * A confirmed unit takes one place on its event date and one of its ticket
 * type. A pending_payment unit takes them only while its signup's payment
 * hold runs. Any other unit status (failed, expired, cancelled, refunded)
 * takes none. Unit status, not signup status, decides.
 *
 * Recurrence: a single_instance or multiple_instances unit takes a place on
 * the occurrence it was bought for. A whole_series unit takes one place of
 * its ticket type, and one place on every occurrence of its series that
 * starts at or after the purchase (the mid-series rule).
 *
 * During the move to ticket units two kinds of admission without units keep
 * their places: a signup whose units have not been backfilled yet (counted
 * by its quantity), and a companion plugin's admission with no signup behind
 * it, reported through the `fair_events_capacity_legacy_admissions` filter.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TicketCapacity {

	/**
	 * Count the places an event date has taken.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int
	 */
	public static function count_event_date( int $event_date_id ) {
		global $wpdb;

		$event_date = self::get_event_date_row( $event_date_id );
		if ( ! $event_date ) {
			return 0;
		}

		$series_ids = self::get_series_ids( self::get_series_master_id( $event_date ) );
		$now        = gmdate( 'Y-m-d H:i:s' );

		if ( count( $series_ids ) < 2 ) {
			$units = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM %i AS t INNER JOIN %i AS s ON s.id = t.signup_id
					WHERE t.event_date_id = %d
					AND ( t.status = 'confirmed' OR ( t.status = 'pending_payment' AND s.payment_expires_at > %s ) )",
					self::tickets_table(),
					self::signups_table(),
					$event_date_id,
					$now
				)
			);

			$unbackfilled = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COALESCE( SUM( GREATEST( s.quantity, 1 ) ), 0 ) FROM %i AS s
					WHERE s.event_date_id = %d
					AND ( s.status = 'confirmed' OR ( s.status = 'pending_payment' AND s.payment_expires_at > %s ) )
					AND NOT EXISTS ( SELECT 1 FROM %i AS t WHERE t.signup_id = s.id )",
					self::signups_table(),
					$event_date_id,
					$now,
					self::tickets_table()
				)
			);
		} else {
			// A whole_series unit is stored on the event date it was bought
			// from, which may be any occurrence of the series.
			$units = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM %i AS t INNER JOIN %i AS s ON s.id = t.signup_id LEFT JOIN %i AS tt ON tt.id = t.ticket_type_id
					WHERE ( t.status = 'confirmed' OR ( t.status = 'pending_payment' AND s.payment_expires_at > %s ) )
					AND (
						( t.event_date_id = %d AND ( tt.recurrence_scope IS NULL OR tt.recurrence_scope <> 'whole_series' ) )
						OR ( tt.recurrence_scope = 'whole_series' AND s.created_at <= %s AND t.event_date_id IN ( " . implode( ', ', array_fill( 0, count( $series_ids ), '%d' ) ) . ' ) )
					)',
					array_merge(
						array( self::tickets_table(), self::signups_table(), self::ticket_types_table(), $now, $event_date_id, (string) $event_date->start_datetime ),
						$series_ids
					)
				)
			);

			$unbackfilled = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COALESCE( SUM( GREATEST( s.quantity, 1 ) ), 0 ) FROM %i AS s LEFT JOIN %i AS tt ON tt.id = s.ticket_type_id
					WHERE ( s.status = 'confirmed' OR ( s.status = 'pending_payment' AND s.payment_expires_at > %s ) )
					AND NOT EXISTS ( SELECT 1 FROM %i AS t WHERE t.signup_id = s.id )
					AND (
						( s.event_date_id = %d AND ( tt.recurrence_scope IS NULL OR tt.recurrence_scope <> 'whole_series' ) )
						OR ( tt.recurrence_scope = 'whole_series' AND s.created_at <= %s AND s.event_date_id IN ( " . implode( ', ', array_fill( 0, count( $series_ids ), '%d' ) ) . ' ) )
					)',
					array_merge(
						array( self::signups_table(), self::ticket_types_table(), $now, self::tickets_table(), $event_date_id, (string) $event_date->start_datetime ),
						$series_ids
					)
				)
			);
		}

		/**
		 * Filters the number of active admissions on an event date that have
		 * no fair-events signup behind them (e.g. a companion plugin's
		 * relationships that predate ticket units).
		 *
		 * @param int    $count Admissions without a signup. Default 0.
		 * @param string $scope 'event_date'.
		 * @param int    $id    Event date ID.
		 */
		$legacy = (int) apply_filters( 'fair_events_capacity_legacy_admissions', 0, 'event_date', $event_date_id );

		return $units + $unbackfilled + max( 0, $legacy );
	}

	/**
	 * Count the places a ticket type has taken.
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return int
	 */
	public static function count_ticket_type( int $ticket_type_id ) {
		global $wpdb;

		$now = gmdate( 'Y-m-d H:i:s' );

		$units = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i AS t INNER JOIN %i AS s ON s.id = t.signup_id
				WHERE t.ticket_type_id = %d
				AND ( t.status = 'confirmed' OR ( t.status = 'pending_payment' AND s.payment_expires_at > %s ) )",
				self::tickets_table(),
				self::signups_table(),
				$ticket_type_id,
				$now
			)
		);

		$unbackfilled = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COALESCE( SUM( GREATEST( s.quantity, 1 ) ), 0 ) FROM %i AS s
				WHERE s.ticket_type_id = %d
				AND ( s.status = 'confirmed' OR ( s.status = 'pending_payment' AND s.payment_expires_at > %s ) )
				AND NOT EXISTS ( SELECT 1 FROM %i AS t WHERE t.signup_id = s.id )",
				self::signups_table(),
				$ticket_type_id,
				$now,
				self::tickets_table()
			)
		);

		/** This filter is documented in TicketCapacity::count_event_date(). */
		$legacy = (int) apply_filters( 'fair_events_capacity_legacy_admissions', 0, 'ticket_type', $ticket_type_id );

		return $units + $unbackfilled + max( 0, $legacy );
	}

	/**
	 * Places still available on an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int|null Remaining places, or null when the event date has no limit.
	 */
	public static function remaining_for_event_date( int $event_date_id ) {
		$event_date = EventDates::get_by_id( $event_date_id );
		if ( ! $event_date || null === $event_date->capacity ) {
			return null;
		}

		return max( 0, (int) $event_date->capacity - self::count_event_date( $event_date_id ) );
	}

	/**
	 * Places still available for a ticket type.
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return int|null Remaining places, or null when the ticket type has no limit.
	 */
	public static function remaining_for_ticket_type( int $ticket_type_id ) {
		$ticket_type = TicketType::get_by_id( $ticket_type_id );
		if ( ! $ticket_type || null === $ticket_type->capacity ) {
			return null;
		}

		return max( 0, (int) $ticket_type->capacity - self::count_ticket_type( $ticket_type_id ) );
	}

	/**
	 * Whether a signup currently holds its places: confirmed, or awaiting
	 * payment within a running hold.
	 *
	 * @param object $signup Signup row.
	 * @return bool
	 */
	public static function signup_holds_places( $signup ) {
		if ( 'confirmed' === ( $signup->status ?? '' ) ) {
			return true;
		}

		return 'pending_payment' === ( $signup->status ?? '' )
			&& ! empty( $signup->payment_expires_at )
			&& strtotime( $signup->payment_expires_at . ' UTC' ) > time();
	}

	/**
	 * Describe what a signup row asks of capacity.
	 *
	 * @param object $signup Signup row.
	 * @return array{event_date_id: int, ticket_type_id: int, quantity: int}
	 */
	public static function demand_for_signup( $signup ) {
		return array(
			'event_date_id'  => (int) ( $signup->event_date_id ?? 0 ),
			'ticket_type_id' => (int) ( $signup->ticket_type_id ?? 0 ),
			'quantity'       => max( 1, (int) ( $signup->quantity ?? 1 ) ),
		);
	}

	/**
	 * Resolve purchase demands into the places each event date and ticket
	 * type must provide. A whole_series ticket needs a place on every
	 * upcoming active occurrence of its series.
	 *
	 * @param array[] $demands Each: event_date_id, ticket_type_id (0 for none), quantity.
	 * @return array{event_dates: array<int, int>, ticket_types: array<int, int>} Places needed, keyed by ID.
	 */
	public static function places_needed( array $demands ) {
		$event_dates  = array();
		$ticket_types = array();

		foreach ( $demands as $demand ) {
			$event_date_id  = (int) ( $demand['event_date_id'] ?? 0 );
			$ticket_type_id = (int) ( $demand['ticket_type_id'] ?? 0 );
			$quantity       = max( 1, (int) ( $demand['quantity'] ?? 1 ) );

			$occupied = $event_date_id ? array( $event_date_id ) : array();
			if ( $event_date_id && $ticket_type_id ) {
				$ticket_type = TicketType::get_by_id( $ticket_type_id );
				if ( $ticket_type && $ticket_type->is_whole_series() ) {
					$occupied = self::get_whole_series_occurrence_ids( $event_date_id );
				}
			}

			foreach ( $occupied as $occupied_id ) {
				$event_dates[ $occupied_id ] = ( $event_dates[ $occupied_id ] ?? 0 ) + $quantity;
			}
			if ( $ticket_type_id ) {
				$ticket_types[ $ticket_type_id ] = ( $ticket_types[ $ticket_type_id ] ?? 0 ) + $quantity;
			}
		}

		return array(
			'event_dates'  => $event_dates,
			'ticket_types' => $ticket_types,
		);
	}

	/**
	 * Find the first event date or ticket type that cannot provide the
	 * places needed.
	 *
	 * @param array $needed Result of places_needed().
	 * @return array{scope: string, id: int, remaining: int}|null Shortage, or null when everything fits.
	 */
	public static function find_shortage( array $needed ) {
		foreach ( $needed['event_dates'] as $event_date_id => $quantity ) {
			$event_date = EventDates::get_by_id( $event_date_id );
			if ( ! $event_date || null === $event_date->capacity ) {
				continue;
			}

			$remaining = (int) $event_date->capacity - self::count_event_date( $event_date_id );
			if ( $quantity > $remaining ) {
				return array(
					'scope'     => 'event_date',
					'id'        => (int) $event_date_id,
					'remaining' => max( 0, $remaining ),
				);
			}
		}

		foreach ( $needed['ticket_types'] as $ticket_type_id => $quantity ) {
			$ticket_type = TicketType::get_by_id( $ticket_type_id );
			if ( ! $ticket_type || null === $ticket_type->capacity ) {
				continue;
			}

			$remaining = (int) $ticket_type->capacity - self::count_ticket_type( $ticket_type_id );
			if ( $quantity > $remaining ) {
				return array(
					'scope'     => 'ticket_type',
					'id'        => (int) $ticket_type_id,
					'remaining' => max( 0, $remaining ),
				);
			}
		}

		return null;
	}

	/**
	 * Run a write inside one transaction that holds row locks on every
	 * event date and ticket type the demands touch, so concurrent requests
	 * for the same places run one after another. The callback receives the
	 * shortage found under the lock (null when everything fits). Returning
	 * false or a WP_Error rolls back; anything else commits.
	 *
	 * Never make an external call (e.g. to a payment provider) inside the
	 * callback: the locks are held until it returns.
	 *
	 * @param array[]  $demands  Each: event_date_id, ticket_type_id, quantity.
	 * @param callable $callback Receives the shortage array or null.
	 * @return mixed The callback's result.
	 * @throws \Throwable Re-thrown from the callback after rolling back.
	 */
	public static function with_capacity_lock( array $demands, callable $callback ) {
		global $wpdb;

		$needed = self::places_needed( $demands );

		$wpdb->query( 'START TRANSACTION' );

		try {
			// Lock before the first plain read, so the transaction's
			// snapshot includes every purchase committed before the lock.
			self::lock_rows( self::event_dates_table(), array_keys( $needed['event_dates'] ) );
			self::lock_rows( self::ticket_types_table(), array_keys( $needed['ticket_types'] ) );

			$result = $callback( self::find_shortage( $needed ) );
		} catch ( \Throwable $e ) {
			$wpdb->query( 'ROLLBACK' );
			throw $e;
		}

		if ( false === $result || is_wp_error( $result ) ) {
			$wpdb->query( 'ROLLBACK' );
		} else {
			$wpdb->query( 'COMMIT' );
		}

		return $result;
	}

	/**
	 * Run a write only when every place it needs is still available,
	 * checked and written under the same locks (see with_capacity_lock()).
	 *
	 * @param array[]  $demands Each: event_date_id, ticket_type_id, quantity.
	 * @param callable $write   Performs the write; false or WP_Error rolls back.
	 * @return mixed|WP_Error The write's result, or a 409 error naming what is full.
	 */
	public static function reserve( array $demands, callable $write ) {
		$multiple_dates = count( self::places_needed( $demands )['event_dates'] ) > 1;

		return self::with_capacity_lock(
			$demands,
			static function ( $shortage ) use ( $write, $multiple_dates ) {
				return $shortage ? self::shortage_error( $shortage, $multiple_dates ) : $write();
			}
		);
	}

	/**
	 * Project what an event date or ticket type would hold after adding
	 * places to it, for an administrator's move or ticket-type change.
	 * The places the edited signup already holds there are left out of
	 * `taken`, so re-saving a signup where it already is never counts it
	 * twice.
	 *
	 * @param string $scope             'event_date' or 'ticket_type'.
	 * @param int    $id                Event date ID or ticket type ID.
	 * @param int    $adding            Places the edit adds.
	 * @param int    $exclude_signup_id Signup being edited (0 for none).
	 * @return array{scope: string, id: int, label: string, taken: int, capacity: int|null, after: int}|null Null when the target does not exist.
	 */
	public static function projection( string $scope, int $id, int $adding, int $exclude_signup_id = 0 ) {
		if ( 'ticket_type' === $scope ) {
			$ticket_type = TicketType::get_by_id( $id );
			if ( ! $ticket_type ) {
				return null;
			}
			$label    = (string) $ticket_type->name;
			$capacity = $ticket_type->capacity;
			$taken    = self::count_ticket_type( $id );
		} else {
			$event_date = EventDates::get_by_id( $id );
			if ( ! $event_date ) {
				return null;
			}
			$label    = DateRangeFormatter::format( $event_date->start_datetime, $event_date->end_datetime, (bool) $event_date->all_day );
			$capacity = $event_date->capacity;
			$taken    = self::count_event_date( $id );
		}

		if ( $exclude_signup_id ) {
			$taken -= self::count_signup_units( $exclude_signup_id, $scope, $id );
		}
		$taken = max( 0, $taken );

		return array(
			'scope'    => $scope,
			'id'       => $id,
			'label'    => $label,
			'taken'    => $taken,
			'capacity' => null === $capacity ? null : (int) $capacity,
			'after'    => $taken + max( 0, $adding ),
		);
	}

	/**
	 * Whether a projection goes past its limit.
	 *
	 * @param array $projection Result of projection().
	 * @return bool
	 */
	public static function projection_exceeds( array $projection ) {
		return null !== $projection['capacity'] && $projection['after'] > $projection['capacity'];
	}

	/**
	 * Count the places one signup's units take on an event date or ticket
	 * type.
	 *
	 * @param int    $signup_id Signup row ID.
	 * @param string $scope     'event_date' or 'ticket_type'.
	 * @param int    $id        Event date ID or ticket type ID.
	 * @return int
	 */
	private static function count_signup_units( int $signup_id, string $scope, int $id ) {
		global $wpdb;

		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i AS t INNER JOIN %i AS s ON s.id = t.signup_id
				WHERE t.signup_id = %d AND t.%i = %d
				AND ( t.status = 'confirmed' OR ( t.status = 'pending_payment' AND s.payment_expires_at > %s ) )",
				self::tickets_table(),
				self::signups_table(),
				$signup_id,
				'ticket_type' === $scope ? 'ticket_type_id' : 'event_date_id',
				$id,
				gmdate( 'Y-m-d H:i:s' )
			)
		);
	}

	/**
	 * Build the buyer-facing error for a shortage.
	 *
	 * @param array $shortage       Result of find_shortage().
	 * @param bool  $name_the_date  Whether to say which date is full (purchases spanning several dates).
	 * @return WP_Error
	 */
	public static function shortage_error( array $shortage, $name_the_date = false ) {
		$remaining = (int) $shortage['remaining'];
		$data      = array(
			'status'    => 409,
			'remaining' => $remaining,
		);

		if ( 'ticket_type' === $shortage['scope'] ) {
			$message = 0 === $remaining
				? __( 'This ticket type is sold out.', 'fair-events' )
				: sprintf(
					/* translators: %d: number of tickets still available */
					_n( 'Only %d ticket of this type is left.', 'Only %d tickets of this type are left.', $remaining, 'fair-events' ),
					$remaining
				);

			return new WP_Error( 'ticket_type_sold_out', $message, $data );
		}

		$event_date = $name_the_date ? EventDates::get_by_id( (int) $shortage['id'] ) : null;
		if ( $event_date ) {
			$date_label = DateRangeFormatter::format( $event_date->start_datetime, $event_date->end_datetime, (bool) $event_date->all_day );
			$message    = 0 === $remaining
				? sprintf(
					/* translators: %s: event date and time */
					__( 'The event on %s is fully booked.', 'fair-events' ),
					$date_label
				)
				: sprintf(
					/* translators: 1: number of places still available, 2: event date and time */
					_n( 'Only %1$d place is left for %2$s.', 'Only %1$d places are left for %2$s.', $remaining, 'fair-events' ),
					$remaining,
					$date_label
				);
		} else {
			$message = 0 === $remaining
				? __( 'This event is fully booked.', 'fair-events' )
				: sprintf(
					/* translators: %d: number of places still available */
					_n( 'Only %d place is left.', 'Only %d places are left.', $remaining, 'fair-events' ),
					$remaining
				);
		}

		return new WP_Error( 'event_full', $message, $data );
	}

	/**
	 * Active occurrences of an event date's series that start now or later —
	 * the dates a whole_series ticket bought now covers. A date outside any
	 * series covers only itself.
	 *
	 * @param int $event_date_id Event date the ticket is bought from.
	 * @return int[]
	 */
	private static function get_whole_series_occurrence_ids( int $event_date_id ) {
		global $wpdb;

		$event_date = self::get_event_date_row( $event_date_id );
		if ( ! $event_date ) {
			return array();
		}

		$master_id = self::get_series_master_id( $event_date );
		if ( count( self::get_series_ids( $master_id ) ) < 2 ) {
			return array( $event_date_id );
		}

		return array_map(
			'intval',
			$wpdb->get_col(
				$wpdb->prepare(
					"SELECT id FROM %i WHERE ( id = %d OR ( master_id = %d AND occurrence_type = 'generated' ) ) AND status = 'active' AND start_datetime >= %s ORDER BY id ASC",
					self::event_dates_table(),
					$master_id,
					$master_id,
					current_time( 'mysql' )
				)
			)
		);
	}

	/**
	 * Every event date ID in a series, master included.
	 *
	 * @param int $master_id Series master ID.
	 * @return int[]
	 */
	private static function get_series_ids( int $master_id ) {
		global $wpdb;

		return array_map(
			'intval',
			$wpdb->get_col(
				$wpdb->prepare(
					"SELECT id FROM %i WHERE id = %d OR ( master_id = %d AND occurrence_type = 'generated' ) ORDER BY id ASC",
					self::event_dates_table(),
					$master_id,
					$master_id
				)
			)
		);
	}

	/**
	 * The series master of an event date row (the row itself when it is not
	 * a generated occurrence).
	 *
	 * @param object $event_date Raw event date row.
	 * @return int
	 */
	private static function get_series_master_id( $event_date ) {
		return ( 'generated' === $event_date->occurrence_type && ! empty( $event_date->master_id ) )
			? (int) $event_date->master_id
			: (int) $event_date->id;
	}

	/**
	 * Read the raw event date columns capacity counting needs.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return object|null
	 */
	private static function get_event_date_row( int $event_date_id ) {
		global $wpdb;

		return $wpdb->get_row(
			$wpdb->prepare(
				'SELECT id, master_id, occurrence_type, start_datetime FROM %i WHERE id = %d',
				self::event_dates_table(),
				$event_date_id
			)
		);
	}

	/**
	 * Lock rows by ID in ascending order, so every request acquires locks
	 * in the same order and two purchases cannot deadlock on each other.
	 *
	 * @param string $table Table name.
	 * @param int[]  $ids   Row IDs.
	 * @return void
	 */
	private static function lock_rows( string $table, array $ids ) {
		global $wpdb;

		$ids = array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) );
		if ( ! $ids ) {
			return;
		}
		sort( $ids );

		$wpdb->get_col(
			$wpdb->prepare(
				'SELECT id FROM %i WHERE id IN (' . implode( ', ', array_fill( 0, count( $ids ), '%d' ) ) . ') ORDER BY id ASC FOR UPDATE',
				array_merge( array( $table ), $ids )
			)
		);
	}

	/**
	 * Ticket units table.
	 *
	 * @return string
	 */
	private static function tickets_table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_events_tickets';
	}

	/**
	 * Signups table.
	 *
	 * @return string
	 */
	private static function signups_table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_events_signups';
	}

	/**
	 * Ticket types table.
	 *
	 * @return string
	 */
	private static function ticket_types_table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_events_ticket_types';
	}

	/**
	 * Event dates table.
	 *
	 * @return string
	 */
	private static function event_dates_table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_event_dates';
	}
}
