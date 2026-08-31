<?php
/**
 * Ticket Type Group Restriction model for Fair Events.
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Junction table linking ticket types to groups for availability restrictions.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TicketTypeGroupRestriction {

	/**
	 * Get the restriction table name.
	 *
	 * @return string Table name with prefix.
	 */
	private static function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_ticket_type_group_restrictions';
	}

	/**
	 * Get group IDs for a ticket type.
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return int[] Group IDs.
	 */
	public static function get_group_ids_by_ticket_type_id( $ticket_type_id ) {
		global $wpdb;

		$results = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT group_id FROM %i WHERE ticket_type_id = %d',
				self::get_table_name(),
				$ticket_type_id
			)
		);

		return array_map( 'intval', $results );
	}

	/**
	 * Get restrictions for every ticket type on an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array<int, int[]> Restrictions keyed by ticket type ID.
	 */
	public static function get_all_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT r.ticket_type_id, r.group_id FROM %i r INNER JOIN %i tt ON r.ticket_type_id = tt.id WHERE tt.event_date_id = %d',
				self::get_table_name(),
				$wpdb->prefix . 'fair_events_ticket_types',
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
	 * Replace all restrictions for a ticket type.
	 *
	 * @param int   $ticket_type_id Ticket type ID.
	 * @param int[] $group_ids      Group IDs.
	 * @return void
	 */
	public static function sync_for_ticket_type( $ticket_type_id, $group_ids ) {
		global $wpdb;

		$table_name = self::get_table_name();
		$wpdb->delete( $table_name, array( 'ticket_type_id' => $ticket_type_id ), array( '%d' ) );

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
	 * Delete all restrictions for a ticket type.
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return bool Whether deletion succeeded.
	 */
	public static function delete_by_ticket_type_id( $ticket_type_id ) {
		global $wpdb;

		$result = $wpdb->delete(
			self::get_table_name(),
			array( 'ticket_type_id' => $ticket_type_id ),
			array( '%d' )
		);

		return false !== $result;
	}
}
