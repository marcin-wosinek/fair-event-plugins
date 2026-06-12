<?php
/**
 * Ticket Option Collaborator model for Fair Events
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Models;

defined( 'WPINC' ) || die;

/**
 * Ticket Option Collaborator model class
 *
 * Junction table linking ticket options (activities) to participants who collaborate on them.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TicketOptionCollaborator {

	/**
	 * Get table name
	 *
	 * @return string Table name with prefix.
	 */
	private static function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_ticket_option_collaborators';
	}

	/**
	 * Get participant IDs for a single ticket option
	 *
	 * @param int $ticket_option_id Ticket option ID.
	 * @return int[] Array of participant IDs.
	 */
	public static function get_participant_ids_by_option_id( $ticket_option_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$results = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT participant_id FROM %i WHERE ticket_option_id = %d',
				$table_name,
				$ticket_option_id
			)
		);

		return array_map( 'intval', $results );
	}

	/**
	 * Get all collaborator participants for all ticket options in an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Associative array keyed by ticket_option_id, each value is an array of participant IDs.
	 */
	public static function get_all_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$table_name           = self::get_table_name();
		$ticket_options_table = $wpdb->prefix . 'fair_events_ticket_options';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT c.ticket_option_id, c.participant_id FROM %i c INNER JOIN %i o ON c.ticket_option_id = o.id WHERE o.event_date_id = %d',
				$table_name,
				$ticket_options_table,
				$event_date_id
			)
		);

		$map = array();
		foreach ( $results as $row ) {
			$option_id = (int) $row->ticket_option_id;
			if ( ! isset( $map[ $option_id ] ) ) {
				$map[ $option_id ] = array();
			}
			$map[ $option_id ][] = (int) $row->participant_id;
		}

		return $map;
	}

	/**
	 * Replace all collaborators for a ticket option
	 *
	 * @param int   $ticket_option_id Ticket option ID.
	 * @param int[] $participant_ids  Array of participant IDs.
	 * @return void
	 */
	public static function sync_for_option( $ticket_option_id, $participant_ids ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$wpdb->delete(
			$table_name,
			array( 'ticket_option_id' => $ticket_option_id ),
			array( '%d' )
		);

		$seen = array();
		foreach ( $participant_ids as $participant_id ) {
			$pid = (int) $participant_id;
			if ( $pid <= 0 || isset( $seen[ $pid ] ) ) {
				continue;
			}
			$seen[ $pid ] = true;

			$wpdb->insert(
				$table_name,
				array(
					'ticket_option_id' => $ticket_option_id,
					'participant_id'   => $pid,
				),
				array( '%d', '%d' )
			);
		}
	}

	/**
	 * Delete all collaborators for a ticket option
	 *
	 * @param int $ticket_option_id Ticket option ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_by_option_id( $ticket_option_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->delete(
			$table_name,
			array( 'ticket_option_id' => $ticket_option_id ),
			array( '%d' )
		);

		return false !== $result;
	}
}
