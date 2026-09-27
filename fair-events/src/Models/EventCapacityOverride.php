<?php
/**
 * Event Capacity Override Model
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Model for the fair_events_capacity_overrides table: the audit trail of
 * administrator edits that took a signup past a capacity limit (#1532).
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventCapacityOverride {

	/**
	 * Get the table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_events_capacity_overrides';
	}

	/**
	 * Record an override.
	 *
	 * @param array $data Keys: signup_id, action, from_event_date_id, to_event_date_id,
	 *                    from_ticket_type_id, to_ticket_type_id, ticket_id,
	 *                    ticket_option_id, ticket_option_name, ticket_count, taken,
	 *                    capacity, reason, user_id.
	 * @return int|false Inserted ID or false on failure.
	 */
	public static function create( array $data ) {
		global $wpdb;

		$inserted = $wpdb->query(
			$wpdb->prepare(
				'INSERT INTO %i (signup_id, action, from_event_date_id, to_event_date_id, from_ticket_type_id, to_ticket_type_id, ticket_id, ticket_option_id, ticket_option_name, ticket_count, taken, capacity, reason, user_id, created_at) VALUES (%d, %s, NULLIF(%d, 0), NULLIF(%d, 0), NULLIF(%d, 0), NULLIF(%d, 0), NULLIF(%d, 0), NULLIF(%d, 0), %s, %d, %d, %d, %s, %d, %s)',
				self::table(),
				(int) $data['signup_id'],
				(string) $data['action'],
				(int) ( $data['from_event_date_id'] ?? 0 ),
				(int) ( $data['to_event_date_id'] ?? 0 ),
				(int) ( $data['from_ticket_type_id'] ?? 0 ),
				(int) ( $data['to_ticket_type_id'] ?? 0 ),
				(int) ( $data['ticket_id'] ?? 0 ),
				(int) ( $data['ticket_option_id'] ?? 0 ),
				(string) ( $data['ticket_option_name'] ?? '' ),
				(int) ( $data['ticket_count'] ?? 0 ),
				(int) ( $data['taken'] ?? 0 ),
				(int) ( $data['capacity'] ?? 0 ),
				(string) $data['reason'],
				(int) ( $data['user_id'] ?? 0 ),
				current_time( 'mysql' )
			)
		);

		return $inserted ? (int) $wpdb->insert_id : false;
	}

	/**
	 * Get the overrides recorded for several signups, oldest first.
	 *
	 * @param int[] $signup_ids Signup row IDs.
	 * @return array<int, object[]> Override rows keyed by signup ID.
	 */
	public static function get_by_signup_ids( array $signup_ids ) {
		global $wpdb;

		$signup_ids = array_values( array_unique( array_filter( array_map( 'intval', $signup_ids ) ) ) );
		if ( ! $signup_ids ) {
			return array();
		}

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE signup_id IN (' . implode( ', ', array_fill( 0, count( $signup_ids ), '%d' ) ) . ') ORDER BY created_at ASC, id ASC',
				array_merge( array( self::table() ), $signup_ids )
			)
		);

		$by_signup = array();
		foreach ( $rows as $row ) {
			$by_signup[ (int) $row->signup_id ][] = $row;
		}

		return $by_signup;
	}

	/**
	 * Delete every override recorded for a signup.
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
}
