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
	 * Title (for external/unlinked events)
	 *
	 * @var string|null
	 */
	public $title;

	/**
	 * External URL (for external link events)
	 *
	 * @var string|null
	 */
	public $external_url;

	/**
	 * Link type ('post', 'external', 'none')
	 *
	 * @var string
	 */
	public $link_type = 'post';

	/**
	 * Theme image attachment ID
	 *
	 * @var int|null
	 */
	public $theme_image_id;

	/**
	 * Get event dates by event ID
	 *
	 * Checks the direct event_id column first (primary post), then falls back
	 * to the junction table for secondary linked posts.
	 *
	 * @param int $event_id Event post ID.
	 * @return EventDates|null EventDates object or null if not found.
	 */
	public static function get_by_event_id( $event_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		// Fast path: direct event_id lookup (primary post).
		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_id = %d LIMIT 1',
				$table_name,
				$event_id
			)
		);

		if ( $result ) {
			return self::hydrate( $result );
		}

		// Fallback: check junction table for secondary linked posts.
		$posts_table = $wpdb->prefix . 'fair_event_date_posts';

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT ed.* FROM %i ed JOIN %i edp ON ed.id = edp.event_date_id WHERE edp.post_id = %d LIMIT 1',
				$table_name,
				$posts_table,
				$event_id
			)
		);

		if ( ! $result ) {
			return null;
		}

		return self::hydrate( $result );
	}

	/**
	 * Hydrate an EventDates object from a database row
	 *
	 * @param object $result Database row object.
	 * @return EventDates Hydrated EventDates object.
	 */
	private static function hydrate( $result ) {
		$event_dates                  = new self();
		$event_dates->id              = (int) $result->id;
		$event_dates->event_id        = $result->event_id ? (int) $result->event_id : null;
		$event_dates->start_datetime  = $result->start_datetime;
		$event_dates->end_datetime    = $result->end_datetime;
		$event_dates->all_day         = (bool) $result->all_day;
		$event_dates->occurrence_type = $result->occurrence_type ?? 'single';
		$event_dates->master_id       = $result->master_id ? (int) $result->master_id : null;
		$event_dates->rrule           = $result->rrule ?? null;
		$event_dates->venue_id        = isset( $result->venue_id ) ? (int) $result->venue_id : null;
		$event_dates->title           = $result->title ?? null;
		$event_dates->external_url    = $result->external_url ?? null;
		$event_dates->link_type       = $result->link_type ?? 'post';
		$event_dates->theme_image_id  = isset( $result->theme_image_id ) && $result->theme_image_id ? (int) $result->theme_image_id : null;

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
			$dates[] = self::hydrate( $result );
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
				// Sync to postmeta for all linked posts.
				self::sync_to_postmeta( $event_id, $start, $end, $all_day );
				self::sync_all_linked_postmeta( (int) $existing->id );
				return (int) $existing->id;
			}
			return false;
		} else {
			$result = $wpdb->insert( $table_name, $data, $format );

			if ( $result ) {
				// Sync to postmeta for all linked posts.
				self::sync_to_postmeta( $event_id, $start, $end, $all_day );
				self::sync_all_linked_postmeta( $wpdb->insert_id );
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

		// Always sync to postmeta for all linked posts.
		self::sync_to_postmeta( $event_id, $start, $end, $all_day );
		if ( $existing ) {
			self::sync_all_linked_postmeta( $existing->id );
		}

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
	 * Syncs to the given post and all linked posts via junction table.
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

		// Also sync to all linked posts via junction table.
		$event_date = self::get_by_event_id( $event_id );
		if ( $event_date ) {
			$linked_post_ids = self::get_linked_post_ids( $event_date->id );
			foreach ( $linked_post_ids as $linked_post_id ) {
				if ( (int) $linked_post_id !== (int) $event_id ) {
					update_post_meta( $linked_post_id, 'event_start', $start );
					update_post_meta( $linked_post_id, 'event_end', $end );
					update_post_meta( $linked_post_id, 'event_all_day', $all_day );
				}
			}
		}
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

	/**
	 * Get display title for an event date
	 *
	 * Returns the stored title for external/unlinked events,
	 * or the post title for post-linked events.
	 *
	 * @return string|null The display title, or null if no title available.
	 */
	public function get_display_title() {
		// For external/unlinked events, use stored title.
		if ( 'post' !== $this->link_type ) {
			return $this->title;
		}

		// For post-linked events, get the post title.
		if ( $this->event_id ) {
			return get_the_title( $this->event_id );
		}

		return null;
	}

	/**
	 * Get display URL for an event date
	 *
	 * Returns the external URL for external events,
	 * the post permalink for post-linked events,
	 * or null for unlinked events.
	 *
	 * @return string|null The display URL, or null if no link.
	 */
	public function get_display_url() {
		switch ( $this->link_type ) {
			case 'external':
				return $this->external_url;
			case 'post':
				return $this->event_id ? get_permalink( $this->event_id ) : null;
			case 'none':
			default:
				return null;
		}
	}

	/**
	 * Check if this is a standalone event (no linked post)
	 *
	 * @return bool True if standalone (external or unlinked).
	 */
	public function is_standalone() {
		return 'post' !== $this->link_type;
	}

	/**
	 * Get event dates for a date range (including standalone events)
	 *
	 * This method fetches all event dates that fall within the given range,
	 * including both post-linked and standalone (external/unlinked) events.
	 *
	 * @param string $start_date Start date (Y-m-d H:i:s format).
	 * @param string $end_date   End date (Y-m-d H:i:s format).
	 * @return EventDates[] Array of EventDates objects.
	 */
	public static function get_for_date_range( $start_date, $end_date ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE start_datetime <= %s AND (end_datetime >= %s OR (end_datetime IS NULL AND start_datetime >= %s)) ORDER BY start_datetime ASC',
				$table_name,
				$end_date,
				$start_date,
				$start_date
			)
		);

		if ( ! $results ) {
			return array();
		}

		$dates = array();
		foreach ( $results as $result ) {
			$dates[] = self::hydrate( $result );
		}

		return $dates;
	}

	/**
	 * Get standalone event dates for a date range
	 *
	 * Fetches only standalone events (external/unlinked) within the given range.
	 * When category IDs are provided, only returns events matching those categories.
	 *
	 * @param string $start_date   Start date (Y-m-d H:i:s format).
	 * @param string $end_date     End date (Y-m-d H:i:s format).
	 * @param array  $category_ids Optional category term IDs to filter by.
	 * @return EventDates[] Array of EventDates objects.
	 */
	public static function get_standalone_for_date_range( $start_date, $end_date, $category_ids = array() ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		if ( ! empty( $category_ids ) ) {
			$cat_table = $wpdb->prefix . 'fair_event_date_categories';

			$id_placeholders = implode( ',', array_fill( 0, count( $category_ids ), '%d' ) );

			$results = $wpdb->get_results(
				// phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
				$wpdb->prepare(
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
					"SELECT ed.* FROM %i ed INNER JOIN %i edc ON ed.id = edc.event_date_id WHERE edc.term_id IN ($id_placeholders) AND ed.link_type != 'post' AND ed.start_datetime <= %s AND (ed.end_datetime >= %s OR (ed.end_datetime IS NULL AND ed.start_datetime >= %s)) GROUP BY ed.id ORDER BY ed.start_datetime ASC",
					array_merge(
						array( $table_name, $cat_table ),
						array_map( 'intval', $category_ids ),
						array( $end_date, $start_date, $start_date )
					)
				)
			);
		} else {
			$results = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM %i WHERE link_type != 'post' AND start_datetime <= %s AND (end_datetime >= %s OR (end_datetime IS NULL AND start_datetime >= %s)) ORDER BY start_datetime ASC",
					$table_name,
					$end_date,
					$start_date,
					$start_date
				)
			);
		}

		if ( ! $results ) {
			return array();
		}

		$dates = array();
		foreach ( $results as $result ) {
			$dates[] = self::hydrate( $result );
		}

		return $dates;
	}

	/**
	 * Create a standalone event date (external or unlinked)
	 *
	 * @param array $data Event data with keys: start_datetime, end_datetime, all_day, title, link_type, external_url, rrule.
	 * @return int|false The row ID on success, false on failure.
	 */
	public static function create_standalone( $data ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$insert_data = array(
			'event_id'        => null,
			'start_datetime'  => $data['start_datetime'],
			'end_datetime'    => $data['end_datetime'] ?? null,
			'all_day'         => isset( $data['all_day'] ) && $data['all_day'] ? 1 : 0,
			'occurrence_type' => $data['occurrence_type'] ?? 'single',
			'master_id'       => $data['master_id'] ?? null,
			'rrule'           => $data['rrule'] ?? null,
			'title'           => $data['title'],
			'external_url'    => $data['external_url'] ?? null,
			'link_type'       => $data['link_type'],
		);

		$format = array( '%d', '%s', '%s', '%d', '%s', '%d', '%s', '%s', '%s', '%s' );

		$result = $wpdb->insert( $table_name, $insert_data, $format );

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Update event date fields by ID
	 *
	 * @param int   $id   Event date row ID.
	 * @param array $data Associative array of fields to update.
	 * @return bool True on success, false on failure.
	 */
	public static function update_by_id( $id, $data ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$allowed_fields = array(
			'event_id'        => '%d',
			'start_datetime'  => '%s',
			'end_datetime'    => '%s',
			'all_day'         => '%d',
			'occurrence_type' => '%s',
			'master_id'       => '%d',
			'rrule'           => '%s',
			'venue_id'        => '%d',
			'title'           => '%s',
			'external_url'    => '%s',
			'link_type'       => '%s',
			'theme_image_id'  => '%d',
		);

		$update_data   = array();
		$update_format = array();

		foreach ( $data as $key => $value ) {
			if ( isset( $allowed_fields[ $key ] ) ) {
				$update_data[ $key ] = $value;
				$update_format[]     = $allowed_fields[ $key ];
			}
		}

		if ( empty( $update_data ) ) {
			return false;
		}

		$result = $wpdb->update(
			$table_name,
			$update_data,
			array( 'id' => $id ),
			$update_format,
			array( '%d' )
		);

		return $result !== false;
	}

	/**
	 * Delete event date by ID
	 *
	 * Also cleans up junction table entries.
	 *
	 * @param int $id Event date row ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_by_id( $id ) {
		global $wpdb;

		$table_name  = $wpdb->prefix . 'fair_event_dates';
		$posts_table = $wpdb->prefix . 'fair_event_date_posts';

		// Clean up junction table entries.
		$wpdb->delete(
			$posts_table,
			array( 'event_date_id' => $id ),
			array( '%d' )
		);

		$result = $wpdb->delete(
			$table_name,
			array( 'id' => $id ),
			array( '%d' )
		);

		return $result !== false;
	}

	/**
	 * Get unlinked event dates (no linked post)
	 *
	 * Returns event dates where event_id IS NULL and occurrence_type is
	 * 'single' or 'master', ordered by start_datetime descending.
	 *
	 * @return EventDates[] Array of EventDates objects.
	 */
	public static function get_unlinked() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE event_id IS NULL AND occurrence_type IN ('single', 'master') ORDER BY start_datetime DESC",
				$table_name
			)
		);

		if ( ! $results ) {
			return array();
		}

		$dates = array();
		foreach ( $results as $result ) {
			$dates[] = self::hydrate( $result );
		}

		return $dates;
	}

	/**
	 * Delete generated occurrences by master ID
	 *
	 * Used for standalone events that have no event_id.
	 *
	 * @param int $master_id Master event date ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_generated_by_master_id( $master_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$result = $wpdb->delete(
			$table_name,
			array(
				'master_id'       => $master_id,
				'occurrence_type' => 'generated',
			),
			array( '%d', '%s' )
		);

		return $result !== false;
	}

	/**
	 * Create a standalone generated occurrence
	 *
	 * Copies master properties (title, venue_id, link_type, etc.) with new start/end times.
	 *
	 * @param array $data Occurrence data with keys from master plus start/end overrides.
	 * @return int|false The row ID on success, false on failure.
	 */
	public static function create_standalone_occurrence( $data ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$insert_data = array(
			'event_id'        => $data['event_id'] ?? null,
			'start_datetime'  => $data['start_datetime'],
			'end_datetime'    => $data['end_datetime'] ?? null,
			'all_day'         => isset( $data['all_day'] ) && $data['all_day'] ? 1 : 0,
			'occurrence_type' => 'generated',
			'master_id'       => $data['master_id'],
			'rrule'           => null,
			'title'           => $data['title'] ?? null,
			'external_url'    => $data['external_url'] ?? null,
			'link_type'       => $data['link_type'] ?? 'none',
			'venue_id'        => $data['venue_id'] ?? null,
			'theme_image_id'  => $data['theme_image_id'] ?? null,
		);

		$format = array( '%d', '%s', '%s', '%d', '%s', '%d', '%s', '%s', '%s', '%s', '%d', '%d' );

		$result = $wpdb->insert( $table_name, $insert_data, $format );

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Get all linked post IDs for an event date from the junction table
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int[] Array of post IDs.
	 */
	public static function get_linked_post_ids( $event_date_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_date_posts';

		$post_ids = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT post_id FROM %i WHERE event_date_id = %d',
				$table_name,
				$event_date_id
			)
		);

		return array_map( 'intval', $post_ids );
	}

	/**
	 * Add a linked post to an event date in the junction table
	 *
	 * @param int $event_date_id Event date ID.
	 * @param int $post_id       Post ID.
	 * @return bool True on success, false on failure.
	 */
	public static function add_linked_post( $event_date_id, $post_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_date_posts';

		// INSERT IGNORE to avoid duplicate key errors.
		$result = $wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO %i (event_date_id, post_id) VALUES (%d, %d)',
				$table_name,
				$event_date_id,
				$post_id
			)
		);

		return $result !== false;
	}

	/**
	 * Remove a linked post from an event date in the junction table
	 *
	 * @param int $event_date_id Event date ID.
	 * @param int $post_id       Post ID.
	 * @return bool True on success, false on failure.
	 */
	public static function remove_linked_post( $event_date_id, $post_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_date_posts';

		$result = $wpdb->delete(
			$table_name,
			array(
				'event_date_id' => $event_date_id,
				'post_id'       => $post_id,
			),
			array( '%d', '%d' )
		);

		return $result !== false;
	}

	/**
	 * Remove a post from all event dates in the junction table
	 *
	 * Used for post deletion cleanup.
	 *
	 * @param int $post_id Post ID.
	 * @return bool True on success, false on failure.
	 */
	public static function remove_linked_post_from_all( $post_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_date_posts';

		$result = $wpdb->delete(
			$table_name,
			array( 'post_id' => $post_id ),
			array( '%d' )
		);

		return $result !== false;
	}

	/**
	 * Sync postmeta (event_start, event_end, event_all_day) to ALL linked posts
	 *
	 * Includes both the primary post (event_id) and all secondary posts from
	 * the junction table. Safe to call after any date change.
	 *
	 * @param int $event_date_id Event date row ID.
	 * @return void
	 */
	public static function sync_all_linked_postmeta( $event_date_id ) {
		$event_date = self::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return;
		}

		// Collect ALL post IDs: junction table + primary (in case not in junction table).
		$post_ids = self::get_linked_post_ids( $event_date_id );
		if ( $event_date->event_id && ! in_array( (int) $event_date->event_id, $post_ids, true ) ) {
			$post_ids[] = (int) $event_date->event_id;
		}

		foreach ( $post_ids as $post_id ) {
			update_post_meta( $post_id, 'event_start', $event_date->start_datetime );
			update_post_meta( $post_id, 'event_end', $event_date->end_datetime );
			update_post_meta( $post_id, 'event_all_day', $event_date->all_day );
		}
	}

	/**
	 * Get event date by ID
	 *
	 * @param int $id Event date ID.
	 * @return EventDates|null EventDates object or null if not found.
	 */
	public static function get_by_id( $id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d LIMIT 1',
				$table_name,
				$id
			)
		);

		if ( ! $result ) {
			return null;
		}

		return self::hydrate( $result );
	}
}
