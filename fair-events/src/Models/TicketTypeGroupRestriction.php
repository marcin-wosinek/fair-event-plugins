<?php
/**
 * Ticket Type Group Restriction model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Ticket Type Group Restriction model class
 *
 * Junction table linking ticket types to groups for availability restrictions.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TicketTypeGroupRestriction {

	/**
	 * Get table name
	 *
	 * @return string Table name with prefix.
	 */
	private static function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_ticket_type_group_restrictions';
	}

	/**
	 * Get group IDs for a single ticket type
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return int[] Array of group IDs.
	 */
	public static function get_group_ids_by_ticket_type_id( $ticket_type_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$results = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT group_id FROM %i WHERE ticket_type_id = %d',
				$table_name,
				$ticket_type_id
			)
		);

		return array_map( 'intval', $results );
	}

	/**
	 * Get all group restrictions for all ticket types in an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Associative array keyed by ticket_type_id, each value is an array of group IDs.
	 */
	public static function get_all_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$table_name         = self::get_table_name();
		$ticket_types_table = $wpdb->prefix . 'fair_events_ticket_types';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT r.ticket_type_id, r.group_id FROM %i r INNER JOIN %i tt ON r.ticket_type_id = tt.id WHERE tt.event_date_id = %d',
				$table_name,
				$ticket_types_table,
				$event_date_id
			)
		);

		$map = array();
		foreach ( $results as $row ) {
			$type_id = (int) $row->ticket_type_id;
			if ( ! isset( $map[ $type_id ] ) ) {
				$map[ $type_id ] = array();
			}
			$map[ $type_id ][] = (int) $row->group_id;
		}

		return $map;
	}

	/**
	 * Replace all group restrictions for a ticket type
	 *
	 * @param int   $ticket_type_id Ticket type ID.
	 * @param int[] $group_ids      Array of group IDs.
	 * @return void
	 */
	public static function sync_for_ticket_type( $ticket_type_id, $group_ids ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$wpdb->delete(
			$table_name,
			array( 'ticket_type_id' => $ticket_type_id ),
			array( '%d' )
		);

		foreach ( $group_ids as $group_id ) {
			$wpdb->insert(
				$table_name,
				array(
					'ticket_type_id' => $ticket_type_id,
					'group_id'       => (int) $group_id,
				),
				array( '%d', '%d' )
			);
		}
	}

	/**
	 * Delete all restrictions for a ticket type
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_by_ticket_type_id( $ticket_type_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->delete(
			$table_name,
			array( 'ticket_type_id' => $ticket_type_id ),
			array( '%d' )
		);

		return false !== $result;
	}
}
