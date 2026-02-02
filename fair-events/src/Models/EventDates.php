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
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
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
	 * Occurrence type (single, master, generated)
	 *
	 * @var string
	 */
	public $occurrence_type = 'single';

	/**
	 * Master ID (for generated occurrences)
	 *
	 * @var int|null
	 */
	public $master_id;

	/**
	 * Recurrence rule (RRULE format, only on master/single rows)
	 *
	 * @var string|null
	 */
	public $rrule;

	/**
	 * Venue ID
	 *
	 * @var int|null
	 */
	public $venue_id;

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
				'SELECT * FROM %i WHERE event_id = %d LIMIT 1',
				$table_name,
				$event_id
			)
		);

		if ( ! $result ) {
			return null;
		}

		$event_dates                  = new self();
		$event_dates->id              = (int) $result->id;
		$event_dates->event_id        = (int) $result->event_id;
		$event_dates->start_datetime  = $result->start_datetime;
		$event_dates->end_datetime    = $result->end_datetime;
		$event_dates->all_day         = (bool) $result->all_day;
		$event_dates->occurrence_type = $result->occurrence_type ?? 'single';
		$event_dates->master_id       = $result->master_id ? (int) $result->master_id : null;
		$event_dates->rrule           = $result->rrule ?? null;
		$event_dates->venue_id        = isset( $result->venue_id ) ? (int) $result->venue_id : null;

		return $event_dates;
	}

	/**
	 * Get all event dates by event ID (including generated occurrences)
	 *
	 * @param int $event_id Event post ID.
	 * @return EventDates[] Array of EventDates objects.
	 */
	public static function get_all_by_event_id( $event_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_id = %d ORDER BY start_datetime ASC',
				$table_name,
				$event_id
			)
		);

		if ( ! $results ) {
			return array();
		}

		$dates = array();
		foreach ( $results as $result ) {
			$event_dates                  = new self();
			$event_dates->id              = (int) $result->id;
			$event_dates->event_id        = (int) $result->event_id;
			$event_dates->start_datetime  = $result->start_datetime;
			$event_dates->end_datetime    = $result->end_datetime;
			$event_dates->all_day         = (bool) $result->all_day;
			$event_dates->occurrence_type = $result->occurrence_type ?? 'single';
			$event_dates->master_id       = $result->master_id ? (int) $result->master_id : null;
			$event_dates->rrule           = $result->rrule ?? null;
			$event_dates->venue_id        = isset( $result->venue_id ) ? (int) $result->venue_id : null;
			$dates[]                      = $event_dates;
		}

		return $dates;
	}

	/**
	 * Delete generated occurrences for an event
	 *
	 * @param int $event_id Event post ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_generated_occurrences( $event_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$result = $wpdb->delete(
			$table_name,
			array(
				'event_id'        => $event_id,
				'occurrence_type' => 'generated',
			),
			array( '%d', '%s' )
		);

		return $result !== false;
	}

	/**
	 * Save a single occurrence
	 *
	 * @param int      $event_id        Event post ID.
	 * @param string   $start           Start datetime.
	 * @param string   $end             End datetime.
	 * @param bool     $all_day         All day flag.
	 * @param string   $occurrence_type Occurrence type (single, master, generated).
	 * @param int|null $master_id       Master occurrence ID (for generated occurrences).
	 * @return int|false The row ID on success, false on failure.
	 */
	public static function save_occurrence( $event_id, $start, $end, $all_day, $occurrence_type = 'single', $master_id = null ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$data = array(
			'event_id'        => $event_id,
			'start_datetime'  => $start,
			'end_datetime'    => $end,
			'all_day'         => $all_day ? 1 : 0,
			'occurrence_type' => $occurrence_type,
			'master_id'       => $master_id,
		);

		$format = array( '%d', '%s', '%s', '%d', '%s', '%d' );

		$result = $wpdb->insert( $table_name, $data, $format );

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Update the master occurrence (first occurrence of a recurring event)
	 *
	 * @param int         $event_id        Event post ID.
	 * @param string      $start           Start datetime.
	 * @param string      $end             End datetime.
	 * @param bool        $all_day         All day flag.
	 * @param string      $occurrence_type Occurrence type (single or master).
	 * @param string|null $rrule           Recurrence rule (RRULE format).
	 * @return int|false The row ID on success, false on failure.
	 */
	public static function save_or_update_master( $event_id, $start, $end, $all_day, $occurrence_type = 'single', $rrule = null ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		// Check if a master or single occurrence exists.
		$existing = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE event_id = %d AND occurrence_type IN ('single', 'master') LIMIT 1",
				$table_name,
				$event_id
			)
		);

		$data = array(
			'event_id'        => $event_id,
			'start_datetime'  => $start,
			'end_datetime'    => $end,
			'all_day'         => $all_day ? 1 : 0,
			'occurrence_type' => $occurrence_type,
			'master_id'       => null,
			'rrule'           => $rrule,
		);

		$format = array( '%d', '%s', '%s', '%d', '%s', '%d', '%s' );

		if ( $existing ) {
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $existing->id ),
				$format,
				array( '%d' )
			);

			if ( $result !== false ) {
				// Also sync to postmeta for compatibility.
				self::sync_to_postmeta( $event_id, $start, $end, $all_day );
				return (int) $existing->id;
			}
			return false;
		} else {
			$result = $wpdb->insert( $table_name, $data, $format );

			if ( $result ) {
				// Also sync to postmeta for compatibility.
				self::sync_to_postmeta( $event_id, $start, $end, $all_day );
				return $wpdb->insert_id;
			}
			return false;
		}
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

		// Check if record exists.
		$existing = self::get_by_event_id( $event_id );

		$data = array(
			'event_id'       => $event_id,
			'start_datetime' => $start,
			'end_datetime'   => $end,
			'all_day'        => $all_day ? 1 : 0,
		);

		$format = array( '%d', '%s', '%s', '%d' );

		if ( $existing ) {
			// Update existing record.
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $existing->id ),
				$format,
				array( '%d' )
			);
		} else {
			// Insert new record.
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$result = $wpdb->insert( $table_name, $data, $format );
		}

		// Always sync to postmeta for compatibility.
		self::sync_to_postmeta( $event_id, $start, $end, $all_day );

		return $result !== false;
	}

	/**
	 * Delete event dates by event ID.
	 *
	 * @param int $event_id Event post ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_by_event_id( $event_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
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

	/**
	 * Save venue_id for an event
	 *
	 * @param int      $event_id Event post ID.
	 * @param int|null $venue_id Venue ID (null to clear).
	 * @return bool True on success, false on failure.
	 */
	public static function save_venue_id( $event_id, $venue_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$result = $wpdb->update(
			$table_name,
			array( 'venue_id' => $venue_id ),
			array( 'event_id' => $event_id ),
			array( '%d' ),
			array( '%d' )
		);

		return $result !== false;
	}

	/**
	 * Get RRULE by event ID
	 *
	 * @param int $event_id Event post ID.
	 * @return string|null RRULE string or null if not found.
	 */
	public static function get_rrule_by_event_id( $event_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$rrule = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT rrule FROM %i WHERE event_id = %d AND occurrence_type IN ('single', 'master') LIMIT 1",
				$table_name,
				$event_id
			)
		);

		return $rrule ?: null;
	}

	/**
	 * Save RRULE for an event
	 *
	 * @param int         $event_id Event post ID.
	 * @param string|null $rrule    RRULE string (null to clear).
	 * @return bool True on success, false on failure.
	 */
	public static function save_rrule( $event_id, $rrule ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$result = $wpdb->update(
			$table_name,
			array( 'rrule' => $rrule ),
			array(
				'event_id'        => $event_id,
				'occurrence_type' => array( 'single', 'master' ),
			),
			array( '%s' ),
			array( '%d', '%s' )
		);

		// If no row was updated (e.g., no master/single row exists yet), we need to handle that.
		if ( $result === 0 ) {
			// Check if any master/single row exists.
			$existing = $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM %i WHERE event_id = %d AND occurrence_type IN ('single', 'master')",
					$table_name,
					$event_id
				)
			);

			// If a row exists but wasn't updated (value unchanged), that's OK.
			return $existing > 0;
		}

		return $result !== false;
	}
}
