<?php
/**
 * Event Ticket Activity Model
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Model for the fair_events_ticket_activities table: the activities
 * (ticket options) selected for one individual ticket.
 *
 * A selection made with the purchase is written 'confirmed' at once; the
 * ticket's own status decides whether it counts, so a failed or lapsed
 * payment releases it with the ticket. An activity added later and paid on
 * its own is written 'pending_payment' with an expiry, and becomes
 * 'confirmed' once paid.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventTicketActivity {

	/**
	 * Get the ticket activities table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_events_ticket_activities';
	}

	/**
	 * Get the activity rows of several tickets, grouped by ticket.
	 *
	 * @param int[] $ticket_ids Ticket IDs.
	 * @return array<int, object[]> Rows keyed by ticket ID.
	 */
	public static function get_by_ticket_ids( array $ticket_ids ) {
		global $wpdb;

		$ticket_ids = array_values( array_filter( array_map( 'intval', $ticket_ids ) ) );
		if ( ! $ticket_ids ) {
			return array();
		}

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE ticket_id IN (' . implode( ', ', array_fill( 0, count( $ticket_ids ), '%d' ) ) . ') ORDER BY id ASC',
				array_merge( array( self::table() ), $ticket_ids )
			)
		);

		$by_ticket = array();
		foreach ( $rows as $row ) {
			$by_ticket[ (int) $row->ticket_id ][] = $row;
		}

		return $by_ticket;
	}

	/**
	 * Get the option IDs selected for a ticket.
	 *
	 * @param int  $ticket_id      Ticket ID.
	 * @param bool $confirmed_only Leave out activities still awaiting payment.
	 * @return int[]
	 */
	public static function get_option_ids( int $ticket_id, bool $confirmed_only = false ) {
		$option_ids = array();
		foreach ( self::get_by_ticket_ids( array( $ticket_id ) )[ $ticket_id ] ?? array() as $row ) {
			if ( ! $confirmed_only || 'confirmed' === $row->status ) {
				$option_ids[] = (int) $row->ticket_option_id;
			}
		}

		return $option_ids;
	}

	/**
	 * Get the activities that currently take a place on several tickets:
	 * confirmed, or an add-on hold that has not expired. One entry per
	 * ticket and activity, so an activity two tickets hold appears twice.
	 * The tickets' own status is left to the caller.
	 *
	 * @param int[] $ticket_ids Ticket IDs.
	 * @return int[] Ticket option IDs.
	 */
	public static function get_active_option_ids( array $ticket_ids ) {
		$now        = gmdate( 'Y-m-d H:i:s' );
		$option_ids = array();
		foreach ( self::get_by_ticket_ids( $ticket_ids ) as $rows ) {
			foreach ( $rows as $row ) {
				if ( self::is_active_row( $row, $now ) ) {
					$option_ids[] = (int) $row->ticket_option_id;
				}
			}
		}

		return $option_ids;
	}

	/**
	 * Whether an activity row takes a place: confirmed, or an add-on hold
	 * that has not expired.
	 *
	 * @param object      $row Activity row.
	 * @param string|null $now UTC datetime to compare holds against; now by default.
	 * @return bool
	 */
	public static function is_active_row( $row, $now = null ) {
		if ( 'confirmed' === $row->status ) {
			return true;
		}

		return 'pending_payment' === $row->status
			&& ! empty( $row->expires_at )
			&& (string) $row->expires_at > ( $now ?? gmdate( 'Y-m-d H:i:s' ) );
	}

	/**
	 * Flag activities on a ticket as having gone past their activity's
	 * limit (an administrator's override or a late payment).
	 *
	 * @param int   $ticket_id  Ticket ID.
	 * @param int[] $option_ids Ticket option IDs.
	 * @return void
	 */
	public static function mark_over_capacity( int $ticket_id, array $option_ids ) {
		global $wpdb;

		$option_ids = array_values( array_unique( array_filter( array_map( 'intval', $option_ids ) ) ) );
		if ( ! $option_ids ) {
			return;
		}

		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET over_capacity = 1 WHERE ticket_id = %d AND ticket_option_id IN (' . implode( ', ', array_fill( 0, count( $option_ids ), '%d' ) ) . ')',
				array_merge( array( self::table(), $ticket_id ), $option_ids )
			)
		);
	}

	/**
	 * Release a ticket's add-on holds for some activities at once, e.g. when
	 * their payment failed. Confirmed activities are untouched.
	 *
	 * @param int   $ticket_id  Ticket ID.
	 * @param int[] $option_ids Ticket option IDs.
	 * @return int Rows deleted.
	 */
	public static function release_holds( int $ticket_id, array $option_ids ) {
		global $wpdb;

		$option_ids = array_values( array_unique( array_filter( array_map( 'intval', $option_ids ) ) ) );
		if ( ! $option_ids ) {
			return 0;
		}

		return (int) $wpdb->query(
			$wpdb->prepare(
				'DELETE FROM %i WHERE ticket_id = %d AND status = %s AND ticket_option_id IN (' . implode( ', ', array_fill( 0, count( $option_ids ), '%d' ) ) . ')',
				array_merge( array( self::table(), $ticket_id, 'pending_payment' ), $option_ids )
			)
		);
	}

	/**
	 * Confirm activities on a ticket: add the missing ones and settle any
	 * still awaiting payment. Safe to repeat.
	 *
	 * @param int   $ticket_id Ticket ID.
	 * @param array $options   Objects or arrays with `id` and `name`.
	 * @return bool False when a row could not be written.
	 */
	public static function confirm( int $ticket_id, array $options ) {
		global $wpdb;

		foreach ( self::normalize_options( $options ) as $option_id => $option_name ) {
			$written = $wpdb->query(
				$wpdb->prepare(
					'INSERT INTO %i (ticket_id, ticket_option_id, ticket_option_name, status, expires_at, created_at) VALUES (%d, %d, %s, %s, NULL, %s)
					ON DUPLICATE KEY UPDATE ticket_option_name = VALUES(ticket_option_name), status = VALUES(status), expires_at = NULL',
					self::table(),
					$ticket_id,
					$option_id,
					$option_name,
					'confirmed',
					current_time( 'mysql' )
				)
			);
			if ( false === $written ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Hold activities on a ticket while their payment is in flight. A
	 * repeated hold refreshes the expiry; an activity already confirmed on
	 * the ticket is never downgraded.
	 *
	 * @param int    $ticket_id  Ticket ID.
	 * @param array  $options    Objects or arrays with `id` and `name`.
	 * @param string $expires_at UTC datetime the hold lapses at.
	 * @return void
	 */
	public static function hold( int $ticket_id, array $options, string $expires_at ) {
		global $wpdb;

		foreach ( self::normalize_options( $options ) as $option_id => $option_name ) {
			$wpdb->query(
				$wpdb->prepare(
					'INSERT INTO %i (ticket_id, ticket_option_id, ticket_option_name, status, expires_at, created_at) VALUES (%d, %d, %s, %s, %s, %s)
					ON DUPLICATE KEY UPDATE expires_at = IF(status = %s, VALUES(expires_at), expires_at)',
					self::table(),
					$ticket_id,
					$option_id,
					$option_name,
					'pending_payment',
					$expires_at,
					current_time( 'mysql' ),
					'pending_payment'
				)
			);
		}
	}

	/**
	 * Add one activity row only when the ticket does not have that activity
	 * yet. Used to carry historical selections over without touching what
	 * the ticket already records.
	 *
	 * @param int         $ticket_id   Ticket ID.
	 * @param int         $option_id   Ticket option ID.
	 * @param string      $option_name Option name snapshot.
	 * @param string      $status      'confirmed' or 'pending_payment'.
	 * @param string|null $expires_at  UTC hold expiry, for a pending row.
	 * @return void
	 */
	public static function insert_missing( int $ticket_id, int $option_id, string $option_name, string $status, $expires_at = null ) {
		global $wpdb;

		$wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO %i (ticket_id, ticket_option_id, ticket_option_name, status, expires_at, created_at) VALUES (%d, %d, %s, %s, NULLIF(%s, \'\'), %s)',
				self::table(),
				$ticket_id,
				$option_id,
				$option_name,
				'pending_payment' === $status ? 'pending_payment' : 'confirmed',
				(string) $expires_at,
				current_time( 'mysql' )
			)
		);
	}

	/**
	 * Replace a ticket's activities with an administrator's selection.
	 * Activities no longer selected are removed; new ones are added as
	 * confirmed; kept ones keep their status.
	 *
	 * @param int   $ticket_id Ticket ID.
	 * @param array $options   Objects or arrays with `id` and `name`.
	 * @return bool
	 */
	public static function replace_for_ticket( int $ticket_id, array $options ) {
		global $wpdb;

		$selected = self::normalize_options( $options );

		if ( $selected ) {
			$removed = $wpdb->query(
				$wpdb->prepare(
					'DELETE FROM %i WHERE ticket_id = %d AND ticket_option_id NOT IN (' . implode( ', ', array_fill( 0, count( $selected ), '%d' ) ) . ')',
					array_merge( array( self::table(), $ticket_id ), array_keys( $selected ) )
				)
			);
		} else {
			$removed = $wpdb->query(
				$wpdb->prepare( 'DELETE FROM %i WHERE ticket_id = %d', self::table(), $ticket_id )
			);
		}

		if ( false === $removed ) {
			return false;
		}

		foreach ( $selected as $option_id => $option_name ) {
			$added = $wpdb->query(
				$wpdb->prepare(
					'INSERT INTO %i (ticket_id, ticket_option_id, ticket_option_name, status, expires_at, created_at) VALUES (%d, %d, %s, %s, NULL, %s)
					ON DUPLICATE KEY UPDATE ticket_option_name = VALUES(ticket_option_name)',
					self::table(),
					$ticket_id,
					$option_id,
					$option_name,
					'confirmed',
					current_time( 'mysql' )
				)
			);
			if ( false === $added ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Release activity holds whose payment window has passed.
	 *
	 * @return int Rows deleted.
	 */
	public static function delete_expired_holds() {
		global $wpdb;

		return (int) $wpdb->query(
			$wpdb->prepare(
				'DELETE FROM %i WHERE status = %s AND expires_at IS NOT NULL AND expires_at <= %s',
				self::table(),
				'pending_payment',
				gmdate( 'Y-m-d H:i:s' )
			)
		);
	}

	/**
	 * Delete the activities of several tickets.
	 *
	 * @param int[] $ticket_ids Ticket IDs.
	 * @return void
	 */
	public static function delete_by_ticket_ids( array $ticket_ids ) {
		global $wpdb;

		$ticket_ids = array_values( array_filter( array_map( 'intval', $ticket_ids ) ) );
		if ( ! $ticket_ids ) {
			return;
		}

		$wpdb->query(
			$wpdb->prepare(
				'DELETE FROM %i WHERE ticket_id IN (' . implode( ', ', array_fill( 0, count( $ticket_ids ), '%d' ) ) . ')',
				array_merge( array( self::table() ), $ticket_ids )
			)
		);
	}

	/**
	 * Map options to option ID => name, dropping entries without an ID.
	 *
	 * @param array $options Objects or arrays with `id` and `name`.
	 * @return array<int, string>
	 */
	private static function normalize_options( array $options ) {
		$normalized = array();
		foreach ( $options as $option ) {
			$option_id = (int) ( is_array( $option ) ? ( $option['id'] ?? 0 ) : ( $option->id ?? 0 ) );
			if ( $option_id ) {
				$normalized[ $option_id ] = (string) ( is_array( $option ) ? ( $option['name'] ?? '' ) : ( $option->name ?? '' ) );
			}
		}

		return $normalized;
	}
}
