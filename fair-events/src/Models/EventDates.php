<?php
/**
 * EventDates model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * EventDates model class
 */
class EventDates {

	/**
	 * Event ID
	 *
	 * @var int
	 */
	public $id;

	/**
	 * Event post ID
	 *
	 * @var int
	 */
	public $event_id;

	/**
	 * Start datetime
	 *
	 * @var string
	 */
	public $start_datetime;

	/**
	 * End datetime
	 *
	 * @var string|null
	 */
	public $end_datetime;

	/**
	 * All day flag
	 *
	 * @var bool
	 */
	public $all_day;

	/**
	 * Get event dates by event ID
	 *
	 * @param int $event_id Event post ID.
	 * @return EventDates|null EventDates object or null if not found.
	 */
	public static function get_by_event_id( $event_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$result = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$table_name} WHERE event_id = %d LIMIT 1",
				$event_id
			)
		);

		if ( ! $result ) {
			return null;
		}

		$event_dates                 = new self();
		$event_dates->id             = (int) $result->id;
		$event_dates->event_id       = (int) $result->event_id;
		$event_dates->start_datetime = $result->start_datetime;
		$event_dates->end_datetime   = $result->end_datetime;
		$event_dates->all_day        = (bool) $result->all_day;

		return $event_dates;
	}

	/**
	 * Save event dates (dual-write to both table and postmeta)
	 *
	 * @param int    $event_id Event post ID.
	 * @param string $start    Start datetime.
	 * @param string $end      End datetime.
	 * @param bool   $all_day  All day flag.
	 * @return bool True on success, false on failure.
	 */
	public static function save( $event_id, $start, $end, $all_day ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		// Check if record exists
		$existing = self::get_by_event_id( $event_id );

		$data = array(
			'event_id'       => $event_id,
			'start_datetime' => $start,
			'end_datetime'   => $end,
			'all_day'        => $all_day ? 1 : 0,
		);

		$format = array( '%d', '%s', '%s', '%d' );

		if ( $existing ) {
			// Update existing record
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $existing->id ),
				$format,
				array( '%d' )
			);
		} else {
			// Insert new record
			$result = $wpdb->insert( $table_name, $data, $format );
		}

		// Always sync to postmeta for compatibility
		self::sync_to_postmeta( $event_id, $start, $end, $all_day );

		return $result !== false;
	}

	/**
	 * Delete event dates by event ID
	 *
	 * @param int $event_id Event post ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_by_event_id( $event_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$result = $wpdb->delete(
			$table_name,
			array( 'event_id' => $event_id ),
			array( '%d' )
		);

		return $result !== false;
	}

	/**
	 * Sync event dates to postmeta (for backward compatibility)
	 *
	 * @param int    $event_id Event post ID.
	 * @param string $start    Start datetime.
	 * @param string $end      End datetime.
	 * @param bool   $all_day  All day flag.
	 * @return void
	 */
	private static function sync_to_postmeta( $event_id, $start, $end, $all_day ) {
		update_post_meta( $event_id, 'event_start', $start );
		update_post_meta( $event_id, 'event_end', $end );
		update_post_meta( $event_id, 'event_all_day', $all_day );
	}
}
