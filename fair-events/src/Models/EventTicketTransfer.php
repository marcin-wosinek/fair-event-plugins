<?php
/**
 * Event Ticket Transfer Model
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Model for the fair_events_ticket_transfers table: the history of
 * administrator changes to a ticket's holder (#2133). Holders are kept as
 * participant IDs only; names and emails are read from the current profiles.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventTicketTransfer {

	/**
	 * Get the table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_events_ticket_transfers';
	}

	/**
	 * Record one change of holder, timestamped in UTC.
	 *
	 * @param int $ticket_id           Ticket ID.
	 * @param int $from_participant_id Holder before the change; 0 when unknown.
	 * @param int $to_participant_id   Holder after the change.
	 * @param int $user_id             WordPress user who made the change.
	 * @return int|false Inserted ID or false on failure.
	 */
	public static function create( int $ticket_id, int $from_participant_id, int $to_participant_id, int $user_id ) {
		global $wpdb;

		$inserted = $wpdb->query(
			$wpdb->prepare(
				'INSERT INTO %i (ticket_id, from_participant_id, to_participant_id, user_id, created_at) VALUES (%d, NULLIF(%d, 0), NULLIF(%d, 0), %d, %s)',
				self::table(),
				$ticket_id,
				$from_participant_id,
				$to_participant_id,
				$user_id,
				gmdate( 'Y-m-d H:i:s' )
			)
		);

		return $inserted ? (int) $wpdb->insert_id : false;
	}

	/**
	 * A ticket's holder changes, oldest first.
	 *
	 * @param int $ticket_id Ticket ID.
	 * @return object[]
	 */
	public static function get_by_ticket_id( int $ticket_id ) {
		global $wpdb;

		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE ticket_id = %d ORDER BY created_at ASC, id ASC',
				self::table(),
				$ticket_id
			)
		);
	}

	/**
	 * Delete the history of tickets that are being deleted.
	 *
	 * @param int[] $ticket_ids Ticket IDs.
	 * @return int|false Deleted row count, or false on error.
	 */
	public static function delete_by_ticket_ids( array $ticket_ids ) {
		global $wpdb;

		$ticket_ids = array_values( array_filter( array_map( 'intval', $ticket_ids ) ) );
		if ( ! $ticket_ids ) {
			return 0;
		}

		return $wpdb->query(
			$wpdb->prepare(
				'DELETE FROM %i WHERE ticket_id IN (' . implode( ', ', array_fill( 0, count( $ticket_ids ), '%d' ) ) . ')',
				array_merge( array( self::table() ), $ticket_ids )
			)
		);
	}

	/**
	 * Detach an anonymized participant from every transfer, keeping the
	 * records themselves as non-personal history.
	 *
	 * @param int $participant_id Participant ID.
	 * @return void
	 */
	public static function anonymize_participant( int $participant_id ) {
		global $wpdb;

		foreach ( array( 'from_participant_id', 'to_participant_id' ) as $column ) {
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
}
