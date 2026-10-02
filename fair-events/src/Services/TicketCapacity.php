<?php
/**
 * Ticket Capacity Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Helpers\DateRangeFormatter;
use FairEvents\Models\EventDates;
use FairEvents\Models\EventTicket;
use FairEvents\Models\EventTicketActivity;
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
 * Activities (#1697): every active ticket selecting an activity takes one of
 * its places, so sibling tickets of one purchase choosing the same activity
 * take one place each. A selection is active while its ticket holds its
 * places (as above) and the selection itself is confirmed or an add-on hold
 * that has not expired. An activity's limit applies to each occurrence on
 * its own: a selection counts on its ticket's occurrence, and a whole_series
 * ticket's selection on every occurrence its ticket covers. Selections a
 * companion plugin still records per participant, not per ticket, are
 * reported through the `fair_events_capacity_legacy_activity_selections`
 * filter.
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
	 * Count the places an activity (ticket option) has taken on one
	 * occurrence.
	 *
	 * @param int $ticket_option_id Ticket option ID.
	 * @param int $event_date_id    Occurrence (event date) ID.
	 * @return int
	 */
	public static function count_ticket_option( int $ticket_option_id, int $event_date_id ) {
		global $wpdb;

		$event_date = self::get_event_date_row( $event_date_id );
		if ( ! $event_date ) {
			return 0;
		}

		$series_ids = self::get_series_ids( self::get_series_master_id( $event_date ) );
		$now        = gmdate( 'Y-m-d H:i:s' );

		if ( count( $series_ids ) < 2 ) {
			$selections = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM %i AS ta INNER JOIN %i AS t ON t.id = ta.ticket_id INNER JOIN %i AS s ON s.id = t.signup_id
					WHERE ta.ticket_option_id = %d AND t.event_date_id = %d
					AND ( ta.status = 'confirmed' OR ( ta.status = 'pending_payment' AND ta.expires_at > %s ) )
					AND ( t.status = 'confirmed' OR ( t.status = 'pending_payment' AND s.payment_expires_at > %s ) )",
					self::ticket_activities_table(),
					self::tickets_table(),
					self::signups_table(),
					$ticket_option_id,
					$event_date_id,
					$now,
					$now
				)
			);
		} else {
			$selections = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM %i AS ta INNER JOIN %i AS t ON t.id = ta.ticket_id INNER JOIN %i AS s ON s.id = t.signup_id LEFT JOIN %i AS tt ON tt.id = t.ticket_type_id
					WHERE ta.ticket_option_id = %d
					AND ( ta.status = 'confirmed' OR ( ta.status = 'pending_payment' AND ta.expires_at > %s ) )
					AND ( t.status = 'confirmed' OR ( t.status = 'pending_payment' AND s.payment_expires_at > %s ) )
					AND (
						( t.event_date_id = %d AND ( tt.recurrence_scope IS NULL OR tt.recurrence_scope <> 'whole_series' ) )
						OR ( tt.recurrence_scope = 'whole_series' AND s.created_at <= %s AND t.event_date_id IN ( " . implode( ', ', array_fill( 0, count( $series_ids ), '%d' ) ) . ' ) )
					)',
					array_merge(
						array( self::ticket_activities_table(), self::tickets_table(), self::signups_table(), self::ticket_types_table(), $ticket_option_id, $now, $now, $event_date_id, (string) $event_date->start_datetime ),
						$series_ids
					)
				)
			);
		}

		/**
		 * Filters the number of active activity selections on an occurrence
		 * that are not stored on an individual ticket (e.g. a companion
		 * plugin's participant-level selections from before activities were
		 * stored per ticket).
		 *
		 * @param int   $count            Selections without a ticket. Default 0.
		 * @param int   $ticket_option_id Ticket option ID.
		 * @param int   $event_date_id    Occurrence (event date) ID.
		 * @param int[] $series_ids       Every event date of the occurrence's series (just the occurrence outside a series).
		 */
		$legacy = (int) apply_filters( 'fair_events_capacity_legacy_activity_selections', 0, $ticket_option_id, $event_date_id, count( $series_ids ) < 2 ? array( $event_date_id ) : $series_ids );

		return $selections + max( 0, $legacy );
	}

	/**
	 * Places still available in an activity on one occurrence.
	 *
	 * @param int $ticket_option_id Ticket option ID.
	 * @param int $event_date_id    Occurrence (event date) ID.
	 * @return int|null Remaining places, or null when the activity has no limit.
	 */
	public static function remaining_for_ticket_option( int $ticket_option_id, int $event_date_id ) {
		$option = self::get_ticket_option_rows( array( $ticket_option_id ) )[ $ticket_option_id ] ?? null;
		if ( ! $option || null === $option->capacity ) {
			return null;
		}

		return max( 0, (int) $option->capacity - self::count_ticket_option( $ticket_option_id, $event_date_id ) );
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
	 * Describe what a signup row asks of capacity, including the activities
	 * selected on its tickets that are not cancelled or refunded on their
	 * own.
	 *
	 * @param object $signup Signup row.
	 * @return array{event_date_id: int, ticket_type_id: int, quantity: int, option_ids: int[]}
	 */
	public static function demand_for_signup( $signup ) {
		$tickets = array_filter(
			EventTicket::get_by_signup_id( (int) ( $signup->id ?? 0 ) ),
			static function ( $ticket ) {
				return ! in_array( (string) $ticket->status, EventTicket::FINAL_UNIT_STATUSES, true );
			}
		);

		return array(
			'event_date_id'  => (int) ( $signup->event_date_id ?? 0 ),
			'ticket_type_id' => (int) ( $signup->ticket_type_id ?? 0 ),
			'quantity'       => max( 1, (int) ( $signup->quantity ?? 1 ) ),
			'option_ids'     => EventTicketActivity::get_active_option_ids( array_map( static fn( $ticket ) => (int) $ticket->id, $tickets ) ),
		);
	}

	/**
	 * Resolve demands into the places each event date, ticket type and
	 * activity must provide. A whole_series ticket needs a place on every
	 * upcoming active occurrence of its series, and so does each activity
	 * it selects.
	 *
	 * A demand's quantity is the number of tickets it adds (0 when it only
	 * adds activities to existing tickets); option_ids lists one entry per
	 * activity place, so an activity chosen by two tickets appears twice.
	 *
	 * @param array[] $demands Each: event_date_id, ticket_type_id (0 for none), quantity, option_ids (optional).
	 * @return array{event_dates: array<int, int>, ticket_types: array<int, int>, ticket_options: array<int, array<int, int>>} Places needed, keyed by ID (activities by option ID, then occurrence ID).
	 */
	public static function places_needed( array $demands ) {
		$event_dates    = array();
		$ticket_types   = array();
		$ticket_options = array();

		foreach ( $demands as $demand ) {
			$event_date_id  = (int) ( $demand['event_date_id'] ?? 0 );
			$ticket_type_id = (int) ( $demand['ticket_type_id'] ?? 0 );
			$quantity       = isset( $demand['quantity'] ) ? max( 0, (int) $demand['quantity'] ) : 1;
			$option_ids     = array_filter( array_map( 'intval', (array) ( $demand['option_ids'] ?? array() ) ) );

			$occupied = $event_date_id ? array( $event_date_id ) : array();
			if ( $event_date_id && $ticket_type_id ) {
				$ticket_type = TicketType::get_by_id( $ticket_type_id );
				if ( $ticket_type && $ticket_type->is_whole_series() ) {
					$occupied = self::get_whole_series_occurrence_ids( $event_date_id );
				}
			}

			if ( $quantity > 0 ) {
				foreach ( $occupied as $occupied_id ) {
					$event_dates[ $occupied_id ] = ( $event_dates[ $occupied_id ] ?? 0 ) + $quantity;
				}
				if ( $ticket_type_id ) {
					$ticket_types[ $ticket_type_id ] = ( $ticket_types[ $ticket_type_id ] ?? 0 ) + $quantity;
				}
			}

			foreach ( $option_ids as $option_id ) {
				foreach ( $occupied as $occupied_id ) {
					$ticket_options[ $option_id ][ $occupied_id ] = ( $ticket_options[ $option_id ][ $occupied_id ] ?? 0 ) + 1;
				}
			}
		}

		return array(
			'event_dates'    => $event_dates,
			'ticket_types'   => $ticket_types,
			'ticket_options' => $ticket_options,
		);
	}

	/**
	 * Find the first event date, ticket type or activity that cannot provide
	 * the places needed.
	 *
	 * @param array $needed Result of places_needed().
	 * @return array{scope: string, id: int, remaining: int, event_date_id?: int}|null Shortage, or null when everything fits.
	 */
	public static function find_shortage( array $needed ) {
		$shortages = self::find_shortages( $needed );

		return $shortages ? $shortages[0] : null;
	}

	/**
	 * Find every event date, ticket type and activity occurrence that
	 * cannot provide the places needed, in that order.
	 *
	 * @param array $needed Result of places_needed().
	 * @return array[] Shortages: scope, id, remaining, and event_date_id for an activity.
	 */
	public static function find_shortages( array $needed ) {
		$shortages = array();

		foreach ( $needed['event_dates'] as $event_date_id => $quantity ) {
			$event_date = EventDates::get_by_id( $event_date_id );
			if ( ! $event_date || null === $event_date->capacity ) {
				continue;
			}

			$remaining = (int) $event_date->capacity - self::count_event_date( $event_date_id );
			if ( $quantity > $remaining ) {
				$shortages[] = array(
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
				$shortages[] = array(
					'scope'     => 'ticket_type',
					'id'        => (int) $ticket_type_id,
					'remaining' => max( 0, $remaining ),
				);
			}
		}

		$needed_options = $needed['ticket_options'] ?? array();
		$options        = self::get_ticket_option_rows( array_keys( $needed_options ) );
		foreach ( $needed_options as $option_id => $by_event_date ) {
			$option = $options[ (int) $option_id ] ?? null;
			if ( ! $option || null === $option->capacity ) {
				continue;
			}

			foreach ( $by_event_date as $event_date_id => $quantity ) {
				$remaining = (int) $option->capacity - self::count_ticket_option( (int) $option_id, (int) $event_date_id );
				if ( $quantity > $remaining ) {
					$shortages[] = array(
						'scope'         => 'ticket_option',
						'id'            => (int) $option_id,
						'event_date_id' => (int) $event_date_id,
						'remaining'     => max( 0, $remaining ),
					);
				}
			}
		}

		return $shortages;
	}

	/**
	 * Run a write inside one transaction that holds row locks on every
	 * event date, ticket type and activity the demands touch, always taken
	 * in that table order, so concurrent requests
	 * for the same places run one after another. The callback receives the
	 * shortage found under the lock (null when everything fits). Returning
	 * false or a WP_Error rolls back; anything else commits.
	 *
	 * Never make an external call (e.g. to a payment provider) inside the
	 * callback: the locks are held until it returns.
	 *
	 * @param array[]  $demands  Each: event_date_id, ticket_type_id, quantity, option_ids.
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
			self::lock_rows( self::ticket_options_table(), array_keys( $needed['ticket_options'] ) );

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
	 * An optional $existing callback runs first, under the same locks: when
	 * it returns anything but null, the write was already made (a retried
	 * checkout), so that is returned without checking capacity or writing
	 * again.
	 *
	 * @param array[]       $demands  Each: event_date_id, ticket_type_id, quantity, option_ids.
	 * @param callable      $write    Performs the write; false or WP_Error rolls back.
	 * @param callable|null $existing Returns an earlier write's result, or null when there is none.
	 * @return mixed|WP_Error The write's result, or a 409 error naming what is full.
	 */
	public static function reserve( array $demands, callable $write, ?callable $existing = null ) {
		$needed         = self::places_needed( $demands );
		$multiple_dates = count( $needed['event_dates'] ) > 1;
		foreach ( $needed['ticket_options'] as $by_event_date ) {
			$multiple_dates = $multiple_dates || count( $by_event_date ) > 1;
		}

		return self::with_capacity_lock(
			$demands,
			static function ( $shortage ) use ( $write, $existing, $multiple_dates ) {
				$earlier = $existing ? $existing() : null;
				if ( null !== $earlier ) {
					return $earlier;
				}

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
	 * Project what each limited activity would hold after the activity
	 * places the demands add, for an administrator's edit or move. The
	 * demands carry only the places being added, so a selection a ticket
	 * already holds is never counted twice.
	 *
	 * @param array[] $demands Each: event_date_id, ticket_type_id, quantity, option_ids.
	 * @return array[] Projections (scope 'ticket_option', id, event_date_id, label, taken, capacity, after), limited activities only.
	 */
	public static function activity_projections( array $demands ) {
		$needed      = self::places_needed( $demands )['ticket_options'];
		$options     = self::get_ticket_option_rows( array_keys( $needed ) );
		$projections = array();

		foreach ( $needed as $option_id => $by_event_date ) {
			$option = $options[ (int) $option_id ] ?? null;
			if ( ! $option || null === $option->capacity ) {
				continue;
			}

			foreach ( $by_event_date as $event_date_id => $adding ) {
				$label = (string) $option->name;
				if ( count( $by_event_date ) > 1 ) {
					$event_date = EventDates::get_by_id( (int) $event_date_id );
					if ( $event_date ) {
						$label = sprintf(
							/* translators: 1: activity name, 2: event date and time */
							__( '%1$s on %2$s', 'fair-events' ),
							$label,
							DateRangeFormatter::format( $event_date->start_datetime, $event_date->end_datetime, (bool) $event_date->all_day )
						);
					}
				}

				$taken         = self::count_ticket_option( (int) $option_id, (int) $event_date_id );
				$projections[] = array(
					'scope'         => 'ticket_option',
					'id'            => (int) $option_id,
					'event_date_id' => (int) $event_date_id,
					'label'         => $label,
					'taken'         => $taken,
					'capacity'      => (int) $option->capacity,
					'after'         => $taken + (int) $adding,
				);
			}
		}

		return $projections;
	}

	/**
	 * Name an activity (ticket option), from the activity catalogue table.
	 *
	 * @param int $ticket_option_id Ticket option ID.
	 * @return string Empty when the activity no longer exists.
	 */
	public static function ticket_option_name( int $ticket_option_id ) {
		$option = self::get_ticket_option_rows( array( $ticket_option_id ) )[ $ticket_option_id ] ?? null;

		return $option ? (string) $option->name : '';
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

		if ( 'ticket_option' === $shortage['scope'] ) {
			$data['ticket_option_id'] = (int) $shortage['id'];
			$data['event_date_id']    = (int) ( $shortage['event_date_id'] ?? 0 );

			$option_name = self::ticket_option_name( (int) $shortage['id'] );
			$event_date  = $name_the_date ? EventDates::get_by_id( (int) ( $shortage['event_date_id'] ?? 0 ) ) : null;
			if ( $event_date ) {
				$date_label = DateRangeFormatter::format( $event_date->start_datetime, $event_date->end_datetime, (bool) $event_date->all_day );
				$message    = 0 === $remaining
					? sprintf(
						/* translators: 1: activity name, 2: event date and time */
						__( '"%1$s" is full on %2$s.', 'fair-events' ),
						$option_name,
						$date_label
					)
					: sprintf(
						/* translators: 1: number of places still available, 2: activity name, 3: event date and time */
						_n( 'Only %1$d place is left in "%2$s" on %3$s.', 'Only %1$d places are left in "%2$s" on %3$s.', $remaining, 'fair-events' ),
						$remaining,
						$option_name,
						$date_label
					);
			} else {
				$message = 0 === $remaining
					? sprintf(
						/* translators: %s: activity name */
						__( '"%s" is full.', 'fair-events' ),
						$option_name
					)
					: sprintf(
						/* translators: 1: number of places still available, 2: activity name */
						_n( 'Only %1$d place is left in "%2$s".', 'Only %1$d places are left in "%2$s".', $remaining, 'fair-events' ),
						$remaining,
						$option_name
					);
			}

			return new WP_Error( 'ticket_option_full', $message, $data );
		}

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
	 * Read activities (ticket options) by ID: the columns capacity needs.
	 *
	 * @param int[] $ticket_option_ids Ticket option IDs.
	 * @return array<int, object> Rows (id, name, capacity) keyed by ID.
	 */
	private static function get_ticket_option_rows( array $ticket_option_ids ) {
		global $wpdb;

		$ticket_option_ids = array_values( array_unique( array_filter( array_map( 'intval', $ticket_option_ids ) ) ) );
		if ( ! $ticket_option_ids ) {
			return array();
		}

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, name, capacity FROM %i WHERE id IN (' . implode( ', ', array_fill( 0, count( $ticket_option_ids ), '%d' ) ) . ')',
				array_merge( array( self::ticket_options_table() ), $ticket_option_ids )
			)
		);

		$by_id = array();
		foreach ( (array) $rows as $row ) {
			$by_id[ (int) $row->id ] = $row;
		}

		return $by_id;
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
	 * Ticket activities table.
	 *
	 * @return string
	 */
	private static function ticket_activities_table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_events_ticket_activities';
	}

	/**
	 * Activities (ticket options) table.
	 *
	 * @return string
	 */
	private static function ticket_options_table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_events_ticket_options';
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
