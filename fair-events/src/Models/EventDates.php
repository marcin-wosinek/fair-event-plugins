<?php
/**
 * EventDates model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

use FairEvents\Helpers\EventTiming;
use FairEvents\Helpers\EventTimingSql;

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
	 * Whether the junction table contains the complete saved selection.
	 *
	 * @var bool
	 */
	public $category_selection_saved = false;

	/**
	 * All day flag
	 *
	 * @var bool
	 */
	public $all_day;

	/**
	 * Site-local start date (Y-m-d), or null for an undated row.
	 *
	 * @var string|null
	 */
	public $start_date;

	/**
	 * Site-local inclusive end date (Y-m-d); the start date for a single-day event.
	 *
	 * @var string|null
	 */
	public $end_date;

	/**
	 * Site-local start time (H:i:s), or null when not specified.
	 *
	 * @var string|null
	 */
	public $start_time;

	/**
	 * Site-local end time (H:i:s), or null when not specified.
	 *
	 * @var string|null
	 */
	public $end_time;

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
	 * Status ('active' or 'cancelled')
	 *
	 * @var string
	 */
	public $status = 'active';

	/**
	 * Publication status ('publish' or 'draft'). Stored on single and master
	 * rows; a generated occurrence always reports its master's.
	 *
	 * @var string
	 */
	public $publication_status = 'publish';

	/**
	 * Recurrence mode ('none', 'rule', 'manual') — explicit series shape.
	 *
	 * @var string
	 */
	public $recurrence_mode = 'none';

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
	 * Attendance mode ('in_person', 'online', 'hybrid')
	 *
	 * @var string
	 */
	public $attendance_mode = 'in_person';

	/**
	 * Joining link, published as the virtual-location URL for online/hybrid events.
	 *
	 * @var string|null
	 */
	public $joining_link;

	/**
	 * Event capacity
	 *
	 * @var int|null
	 */
	public $capacity;

	/**
	 * Free-text address (used when the Venues feature bundle is disabled).
	 *
	 * @var string|null
	 */
	public $address;

	/**
	 * Anchor date (Y-m-d) pinning this row to its originally-generated date.
	 * Set on master and generated rows; null for single occurrences.
	 *
	 * @var string|null
	 */
	public $recurrence_anchor;

	/**
	 * Timing override groups of a generated occurrence (see
	 * EventTiming::OVERRIDE_GROUPS): an overridden group keeps the
	 * occurrence's own values when its series changes.
	 *
	 * @var array<string, bool>
	 */
	public $timing_overrides = array(
		'dates' => false,
		'times' => false,
	);

	/**
	 * Junction-linked post IDs loaded in bulk by preload_linked_post_ids(),
	 * or null when they haven't been, so get_primary_linked_post_id() queries.
	 *
	 * @var int[]|null
	 */
	private $preloaded_linked_post_ids = null;

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

		// Fast path: direct event_id lookup (primary post). Restricted to
		// single/master rows so the lookup always resolves to the series'
		// primary date, never to a generated occurrence within it. Prefer a
		// configured occurrence over an undated row ensured while the post was
		// being created.
		$result = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE event_id = %d AND occurrence_type IN ('single', 'master') ORDER BY start_date IS NULL ASC, id ASC LIMIT 1",
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
				'SELECT ed.* FROM %i ed JOIN %i edp ON ed.id = edp.event_date_id WHERE edp.post_id = %d ORDER BY ed.start_date IS NULL ASC, ed.id ASC LIMIT 1',
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
		$event_dates                           = new self();
		$event_dates->id                       = (int) $result->id;
		$event_dates->event_id                 = $result->event_id ? (int) $result->event_id : null;
		$event_dates->category_selection_saved = ! empty( $result->category_selection_saved );
		$event_dates->all_day                  = (bool) $result->all_day;
		$event_dates->occurrence_type          = $result->occurrence_type ?? 'single';
		$event_dates->master_id                = $result->master_id ? (int) $result->master_id : null;
		$event_dates->rrule                    = $result->rrule ?? null;
		$event_dates->status                   = $result->status ?? 'active';
		$event_dates->publication_status       = $result->publication_status ?? 'publish';
		$event_dates->recurrence_mode          = $result->recurrence_mode ?? 'none';
		$event_dates->venue_id                 = isset( $result->venue_id ) ? (int) $result->venue_id : null;
		$event_dates->title                    = $result->title ?? null;
		$event_dates->external_url             = $result->external_url ?? null;
		$event_dates->link_type                = $result->link_type ?? null;
		$event_dates->attendance_mode          = $result->attendance_mode ?? null;
		$event_dates->joining_link             = $result->joining_link ?? null;
		$event_dates->capacity                 = isset( $result->capacity ) && null !== $result->capacity ? (int) $result->capacity : null;
		$event_dates->address                  = isset( $result->address ) ? $result->address : null;
		$event_dates->recurrence_anchor        = $result->recurrence_anchor ?? null;
		$event_dates->set_timing( EventTiming::from_row( $result ) );
		$event_dates->timing_overrides = EventTiming::overrides_from_row( $result );

		self::resolve_instance( $event_dates );

		return $event_dates;
	}

	/**
	 * Canonical timing of this event date (see EventTiming).
	 *
	 * @return array Canonical timing.
	 */
	public function get_timing() {
		return array(
			'start_date' => $this->start_date,
			'end_date'   => $this->end_date,
			'start_time' => $this->start_time,
			'end_time'   => $this->end_time,
			'all_day'    => (bool) $this->all_day,
		);
	}

	/**
	 * Set the canonical timing properties.
	 *
	 * @param array $timing Canonical timing.
	 * @return void
	 */
	private function set_timing( array $timing ) {
		$this->start_date = $timing['start_date'];
		$this->end_date   = $timing['end_date'];
		$this->start_time = $timing['start_time'];
		$this->end_time   = $timing['end_time'];
	}

	/**
	 * Timing column values for a write from its canonical keys (start_date,
	 * end_date, start_time, end_time, all_day); absent keys are empty.
	 *
	 * @param array $data Write data.
	 * @return array<string, mixed> Column values (see EventTiming::columns()).
	 */
	private static function timing_columns( array $data ) {
		return EventTiming::columns(
			EventTiming::merge( EventTiming::undated(), array_intersect_key( $data, array_flip( EventTiming::KEYS ) ) )
		);
	}

	/**
	 * Timing column values for positional timing arguments: a canonical
	 * timing array, or site-local start/end datetimes and the all-day flag
	 * (see EventTiming::from_datetimes()).
	 *
	 * @param string|array $start   Start datetime, or the canonical timing.
	 * @param string|null  $end     End datetime (ignored with a canonical timing).
	 * @param bool|null    $all_day All-day flag (ignored with a canonical timing).
	 * @return array<string, mixed> Column values (see EventTiming::columns()).
	 */
	private static function timing_arg_columns( $start, $end, $all_day ) {
		if ( is_array( $start ) ) {
			return EventTiming::columns( $start );
		}

		return EventTiming::columns( EventTiming::from_datetimes( $start, $end, ! empty( $all_day ) ) );
	}

	/**
	 * Cache of master rows already fetched during this request, keyed by ID.
	 * Keeps NULL-inherit resolution from re-querying the same master for
	 * every sibling instance in a list.
	 *
	 * @var array<int, EventDates>
	 */
	private static $master_cache = array();

	/**
	 * Resolve NULL inheritable fields on an instance ('generated') row from
	 * its master. Single/master rows and already-overridden fields are left
	 * untouched.
	 *
	 * @param EventDates $event_dates Hydrated event date to resolve in place.
	 * @return void
	 */
	private static function resolve_instance( $event_dates ) {
		if ( 'generated' !== $event_dates->occurrence_type || ! $event_dates->master_id ) {
			return;
		}

		if ( ! array_key_exists( $event_dates->master_id, self::$master_cache ) ) {
			self::$master_cache[ $event_dates->master_id ] = self::get_by_id( $event_dates->master_id );
		}

		$master = self::$master_cache[ $event_dates->master_id ];
		if ( ! $master ) {
			return;
		}

		foreach ( array( 'title', 'venue_id', 'address', 'link_type', 'external_url', 'capacity', 'attendance_mode', 'joining_link' ) as $field ) {
			if ( null === $event_dates->$field ) {
				$event_dates->$field = $master->$field;
			}
		}

		// A series has one publication status, held by its master.
		$event_dates->publication_status = $master->publication_status;
	}

	/**
	 * Load the given master rows into the master cache with one query, so
	 * resolving many instances doesn't look each master up separately. IDs
	 * already cached are skipped; IDs with no row are cached as missing.
	 *
	 * @param array $master_ids Master event-date IDs (falsy values are ignored).
	 * @return void
	 */
	public static function prime_master_cache( array $master_ids ) {
		global $wpdb;

		$ids = array();
		foreach ( $master_ids as $master_id ) {
			$master_id = (int) $master_id;
			if ( $master_id && ! array_key_exists( $master_id, self::$master_cache ) ) {
				$ids[ $master_id ] = $master_id;
			}
		}

		if ( empty( $ids ) ) {
			return;
		}

		$ids        = array_values( $ids );
		$table_name = $wpdb->prefix . 'fair_event_dates';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id IN (' . implode( ', ', array_fill( 0, count( $ids ), '%d' ) ) . ')',
				array_merge( array( $table_name ), $ids )
			)
		);

		foreach ( $ids as $id ) {
			self::$master_cache[ $id ] = null;
		}

		foreach ( (array) $results as $result ) {
			self::$master_cache[ (int) $result->id ] = self::hydrate( $result );
		}
	}

	/**
	 * Whether the event is drafted in Fair Events, and so hidden from public
	 * lists, calendars and feeds.
	 *
	 * @return bool
	 */
	public function is_event_draft() {
		return 'draft' === $this->publication_status;
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
				'SELECT * FROM %i WHERE event_id = %d ORDER BY start_date ASC, start_time ASC',
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

		return false !== $result;
	}

	/**
	 * Save a single occurrence
	 *
	 * @param int          $event_id           Event post ID.
	 * @param string|array $start              Start datetime, or the canonical timing (see
	 *                                         EventTiming), which then replaces $end and $all_day.
	 * @param string|null  $end                End datetime.
	 * @param bool|null    $all_day            All day flag.
	 * @param string       $occurrence_type    Occurrence type (single, master, generated).
	 * @param int|null     $master_id          Master occurrence ID (for generated occurrences).
	 * @param string|null  $recurrence_anchor  Anchor date (Y-m-d).
	 * @param string       $status             Row status ('active' or 'cancelled').
	 * @return int|false The row ID on success, false on failure.
	 */
	public static function save_occurrence( $event_id, $start, $end, $all_day, $occurrence_type = 'single', $master_id = null, $recurrence_anchor = null, $status = 'active' ) {
		global $wpdb;
		$status = in_array( $status, array( 'active', 'cancelled' ), true ) ? $status : 'active';

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$data = array_merge(
			array( 'event_id' => $event_id ),
			self::timing_arg_columns( $start, $end, $all_day ),
			array(
				'occurrence_type'   => $occurrence_type,
				'master_id'         => $master_id,
				'recurrence_anchor' => $recurrence_anchor,
				'status'            => $status,
			)
		);

		$format = array_merge( array( '%d' ), EventTiming::column_formats(), array( '%s', '%d', '%s', '%s' ) );

		$result = $wpdb->insert( $table_name, $data, $format );

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Update the master occurrence (first occurrence of a recurring event)
	 *
	 * @param int          $event_id        Event post ID.
	 * @param string|array $start           Start datetime, or the canonical timing (see
	 *                                      EventTiming), which then replaces $end and $all_day.
	 * @param string|null  $end             End datetime.
	 * @param bool|null    $all_day         All day flag.
	 * @param string       $occurrence_type Occurrence type (single or master).
	 * @param string|null  $rrule           Recurrence rule (RRULE format).
	 * @param string|null  $recurrence_mode Explicit series shape ('none', 'rule', 'manual'). Inferred from $rrule when null.
	 * @return int|false The row ID on success, false on failure.
	 */
	public static function save_or_update_master( $event_id, $start, $end, $all_day, $occurrence_type = 'single', $rrule = null, $recurrence_mode = null ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		// Check if a master or single occurrence exists.
		$existing = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE event_id = %d AND occurrence_type IN ('single', 'master') ORDER BY start_date IS NULL ASC, id ASC LIMIT 1",
				$table_name,
				$event_id
			)
		);

		if ( null === $recurrence_mode ) {
			$recurrence_mode = empty( $rrule ) ? 'none' : 'rule';
		}

		$data = array_merge(
			array( 'event_id' => $event_id ),
			self::timing_arg_columns( $start, $end, $all_day ),
			array(
				'occurrence_type' => $occurrence_type,
				'master_id'       => null,
				'rrule'           => $rrule,
				'recurrence_mode' => $recurrence_mode,
				'link_type'       => 'post',
			)
		);

		$format = array_merge( array( '%d' ), EventTiming::column_formats(), array( '%s', '%d', '%s', '%s', '%s' ) );

		if ( $existing ) {
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $existing->id ),
				$format,
				array( '%d' )
			);

			if ( false !== $result ) {
				/** This action is documented in src/Models/EventDates.php (update_by_id). */
				do_action( 'fair_events_event_date_updated', (int) $existing->id );
				return (int) $existing->id;
			}
			return false;
		} else {
			$result = $wpdb->insert( $table_name, $data, $format );

			if ( $result ) {
				return $wpdb->insert_id;
			}
			return false;
		}
	}

	/**
	 * Save event dates (dual-write to both table and postmeta)
	 *
	 * @param int        $event_id Event post ID.
	 * @param string     $start    Start datetime.
	 * @param string     $end      End datetime.
	 * @param bool       $all_day  All day flag.
	 * @param array|null $timing   Canonical timing (see EventTiming); when given,
	 *                             it is saved instead of $start, $end and $all_day.
	 * @return bool True on success, false on failure.
	 */
	public static function save( $event_id, $start, $end, $all_day, $timing = null ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		// Check if record exists.
		$existing = self::get_by_event_id( $event_id );

		$timing_columns = self::timing_arg_columns( is_array( $timing ) ? $timing : $start, $end, $all_day );

		$data = array_merge(
			array( 'event_id' => $event_id ),
			$timing_columns,
			array( 'link_type' => 'post' )
		);

		$format = array_merge( array( '%d' ), EventTiming::column_formats(), array( '%s' ) );

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

			if ( false !== $result ) {
				/** This action is documented in src/Models/EventDates.php (update_by_id). */
				do_action( 'fair_events_event_date_updated', (int) $existing->id );
			}
		} else {
			// Insert new record.
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$result = $wpdb->insert( $table_name, $data, $format );
		}

		return false !== $result;
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

		return false !== $result;
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

		return false !== $result;
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
				"SELECT rrule FROM %i WHERE event_id = %d AND occurrence_type IN ('single', 'master') ORDER BY start_date IS NULL ASC, id ASC LIMIT 1",
				$table_name,
				$event_id
			)
		);

		return $rrule ? $rrule : null;
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
		if ( 0 === $result ) {
			// Check if any master/single row exists.
			$existing = $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM %i WHERE event_id = %d AND occurrence_type IN ('single', 'master')",
					$table_name,
					$event_id
				)
			);

			// If a row exists but wasn't updated (value unchanged), that's OK.
			return 0 < $existing;
		}

		return false !== $result;
	}

	/**
	 * Get display title for an event date
	 *
	 * Returns the stored title for external/unlinked events,
	 * or the post title for post-linked events, falling back to the master's
	 * linked post for generated occurrences with no event_id of their own
	 * (see get_master_event_id()).
	 *
	 * @return string|null The display title, or null if no title available.
	 */
	public function get_display_title() {
		// For external/unlinked events, use stored title.
		if ( 'post' !== $this->link_type ) {
			return $this->title;
		}

		// For post-linked events, get the post title.
		$event_id = $this->get_resolved_event_id();

		return $event_id ? get_the_title( $event_id ) : null;
	}

	/**
	 * Get the resolved linked post ID for this occurrence
	 *
	 * Generated occurrences don't inherit `event_id` from the master (see
	 * resolve_instance()), so consumers that need the linked post (uid
	 * construction, categories, description, draft detection) should call
	 * this instead of reading `event_id` directly.
	 *
	 * @return int|null Own event_id, the master's event_id for generated
	 *                   post-linked occurrences, or null if unlinked.
	 */
	public function get_resolved_event_id() {
		if ( $this->event_id ) {
			return $this->event_id;
		}

		return $this->get_master_event_id();
	}

	/**
	 * Get display URL for an event date
	 *
	 * Returns the external URL for external events, or the post permalink
	 * for post-linked events (falling back to the master's linked post for
	 * generated occurrences), or the permalink of a post linked via the
	 * junction table (recurring instances linked from the post editor), if
	 * any. Generated occurrences additionally get `?event_date={Y-m-d}`
	 * appended so the page shows that session (see SelectedOccurrence);
	 * master/single rows link to the plain permalink, which is the recurring
	 * overview for a series.
	 *
	 * Per-session listings (calendars, feeds) pass `$as_session` so the
	 * master, which is also the series' first session, links to that session
	 * rather than to the overview.
	 *
	 * @param bool $as_session Whether a series master links to its own session.
	 * @return string|null The display URL, or null if no link.
	 */
	public function get_display_url( $as_session = false ) {
		switch ( $this->link_type ) {
			case 'external':
				return $this->external_url;
			case 'post':
				$event_id = $this->get_resolved_event_id();
				return $event_id ? $this->with_occurrence_arg( get_permalink( $event_id ), $as_session ) : null;
			case 'none':
			default:
				$linked_post_id = $this->get_primary_linked_post_id();
				return $linked_post_id ? $this->with_occurrence_arg( get_permalink( $linked_post_id ), $as_session ) : null;
		}
	}

	/**
	 * Get this event's own page URL, independent of `link_type`.
	 *
	 * Unlike get_display_url() (which points wherever the calendar/RSVP link
	 * is configured to go — an external partner page for `link_type =
	 * 'external'`), this always resolves the permalink of the post linked via
	 * the junction table (see get_primary_linked_post_id()), regardless of
	 * how the link/calendar entry is configured. Used as the joining-link
	 * fallback for online/hybrid events, so the fallback is never an
	 * unrelated external URL (see EventLocation::resolve()).
	 *
	 * @return string|null The event's own page URL, or null if no post is linked.
	 */
	public function get_event_page_url() {
		$linked_post_id = $this->get_primary_linked_post_id();

		return $linked_post_id ? $this->with_occurrence_arg( get_permalink( $linked_post_id ) ) : null;
	}

	/**
	 * Append `?event_date={Y-m-d}` to a URL for generated occurrences, and
	 * for the series master when it should link to its own session.
	 *
	 * @param string|false $url        Permalink to decorate.
	 * @param bool         $as_session Whether a series master links to its own session.
	 * @return string|null Decorated URL, or null if $url was falsy.
	 */
	private function with_occurrence_arg( $url, $as_session = false ) {
		if ( ! $url ) {
			return null;
		}

		$is_session = 'generated' === $this->occurrence_type
			|| ( $as_session && 'master' === $this->occurrence_type && ! empty( $this->start_date ) );

		if ( ! $is_session ) {
			return $url;
		}

		return add_query_arg( 'event_date', \FairEvents\Helpers\OccurrenceDateParam::format( $this ), $url );
	}

	/**
	 * Get the linked post ID for a generated occurrence's master row
	 *
	 * Generated occurrences don't inherit `event_id` from the master (see
	 * resolve_instance()), so a `link_type = 'post'` occurrence with no
	 * `event_id` of its own needs to look up the master's `event_id` directly.
	 *
	 * @return int|null Master's event_id, or null if not a generated occurrence
	 *                   or the master has no linked post.
	 */
	private function get_master_event_id() {
		if ( 'generated' !== $this->occurrence_type || ! $this->master_id ) {
			return null;
		}

		if ( ! array_key_exists( $this->master_id, self::$master_cache ) ) {
			self::$master_cache[ $this->master_id ] = self::get_by_id( $this->master_id );
		}

		$master = self::$master_cache[ $this->master_id ];

		return $master ? $master->event_id : null;
	}

	/**
	 * Get the first post linked to this event date via the junction table
	 *
	 * Links are stored on the master event date (see EventDatesController::link_post()),
	 * so generated occurrences look up their master's linked posts.
	 *
	 * @return int|null Post ID, or null if no linked post.
	 */
	public function get_primary_linked_post_id() {
		$linked_post_ids = null !== $this->preloaded_linked_post_ids
			? $this->preloaded_linked_post_ids
			: self::get_linked_post_ids( $this->get_link_owner_id() );

		return ! empty( $linked_post_ids ) ? $linked_post_ids[0] : null;
	}

	/**
	 * The event date whose junction-table links apply to this row: the
	 * master for a generated occurrence, the row itself otherwise.
	 *
	 * @return int Event date ID.
	 */
	private function get_link_owner_id() {
		return ( 'generated' === $this->occurrence_type && $this->master_id ) ? (int) $this->master_id : (int) $this->id;
	}

	/**
	 * Load the junction-linked posts of many rows with one query, so
	 * get_primary_linked_post_id() (and the display/event-page URLs built on
	 * it) no longer query per row. Rows without links are marked as having
	 * none.
	 *
	 * @param EventDates[] $rows Event date rows.
	 * @return void
	 */
	public static function preload_linked_post_ids( array $rows ) {
		$owner_ids = array();
		foreach ( $rows as $row ) {
			$owner_ids[] = $row->get_link_owner_id();
		}

		$linked = self::get_linked_post_ids_for( $owner_ids );

		foreach ( $rows as $row ) {
			$row->preloaded_linked_post_ids = $linked[ $row->get_link_owner_id() ] ?? array();
		}
	}

	/**
	 * Get the linked post IDs of many event dates with one query, in the
	 * same per-date order as get_linked_post_ids().
	 *
	 * @param int[] $event_date_ids Event date IDs.
	 * @return array<int, int[]> Post IDs keyed by event date ID; dates without
	 *                           links are left out.
	 */
	public static function get_linked_post_ids_for( array $event_date_ids ) {
		global $wpdb;

		$ids = array_values( array_unique( array_filter( array_map( 'intval', $event_date_ids ) ) ) );
		if ( empty( $ids ) ) {
			return array();
		}

		$table_name = $wpdb->prefix . 'fair_event_date_posts';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT event_date_id, post_id FROM %i WHERE event_date_id IN (' . implode( ', ', array_fill( 0, count( $ids ), '%d' ) ) . ') ORDER BY event_date_id ASC, post_id ASC',
				array_merge( array( $table_name ), $ids )
			)
		);

		$linked = array();
		foreach ( (array) $results as $result ) {
			$linked[ (int) $result->event_date_id ][] = (int) $result->post_id;
		}

		return $linked;
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
	 * The WHERE clause is an inclusive overlap check (start <= $end_date AND
	 * end >= $start_date, see EventTimingSql::overlaps()): an event exactly
	 * at $start_date or $end_date is included, one second outside either
	 * edge is excluded (fair-events#678). A date without an end time stays
	 * in range through its whole end date.
	 *
	 * Events drafted in Fair Events are left out unless `$include_event_drafts`
	 * is set; a generated occurrence follows its master's publication status.
	 *
	 * @param string $start_date           Start date (Y-m-d H:i:s format).
	 * @param string $end_date             End date (Y-m-d H:i:s format).
	 * @param bool   $include_event_drafts Whether to include drafted events (admin surfaces only).
	 * @return EventDates[] Array of EventDates objects.
	 */
	public static function get_for_date_range( $start_date, $end_date, $include_event_drafts = false ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$publication_sql = $include_event_drafts ? '' : " AND COALESCE( m.publication_status, ed.publication_status ) = 'publish'";

		list( $overlap_sql, $overlap_args ) = EventTimingSql::overlaps( 'ed', $start_date, $end_date );

		$results = $wpdb->get_results(
			// phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- inherited_select_sql() adds 2 more %i placeholders than visible here.
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- inherited_select_sql(), $publication_sql and $overlap_sql are static internal templates, not user input.
				self::inherited_select_sql() . " WHERE ed.status = 'active'{$publication_sql} AND {$overlap_sql} ORDER BY ed.start_date ASC, ed.start_time ASC",
				array_merge( array( $table_name, $table_name ), $overlap_args )
			)
		);

		if ( ! $results ) {
			return array();
		}

		// The query already applies inherited fields; hydrate() still needs
		// each master, so load them all at once.
		self::prime_master_cache( wp_list_pluck( $results, 'master_id' ) );

		$dates = array();
		foreach ( $results as $result ) {
			$dates[] = self::hydrate( $result );
		}

		return $dates;
	}

	/**
	 * SELECT clause resolving inheritable instance fields from their master
	 * via a self-join, so instance rows that hold NULL (inherit) come back
	 * with the master's value already applied. Used by list queries that can
	 * return many rows, where a per-row lookup (see resolve_instance()) would
	 * mean N+1 queries.
	 *
	 * @return string SELECT ... FROM %i ed LEFT JOIN %i m ... clause (two %i placeholders).
	 */
	private static function inherited_select_sql() {
		return 'SELECT ed.id, ed.event_id, ed.all_day,
			ed.start_date, ed.end_date, ed.start_time, ed.end_time, ed.occurrence_type,
			ed.master_id, ed.rrule, ed.recurrence_anchor, ed.status, ed.recurrence_mode, ed.category_selection_saved, ed.created_at, ed.updated_at,
			COALESCE( m.publication_status, ed.publication_status ) AS publication_status,
			COALESCE( ed.title, m.title ) AS title,
			COALESCE( ed.venue_id, m.venue_id ) AS venue_id,
			COALESCE( ed.address, m.address ) AS address,
			COALESCE( ed.link_type, m.link_type ) AS link_type,
			COALESCE( ed.external_url, m.external_url ) AS external_url,
			COALESCE( ed.capacity, m.capacity ) AS capacity,
			COALESCE( ed.attendance_mode, m.attendance_mode ) AS attendance_mode,
			COALESCE( ed.joining_link, m.joining_link ) AS joining_link
			FROM %i ed LEFT JOIN %i m ON ed.master_id = m.id';
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

		list( $overlap_sql, $overlap_args ) = EventTimingSql::overlaps( 'ed', $start_date, $end_date );

		if ( ! empty( $category_ids ) ) {
			$cat_table = $wpdb->prefix . 'fair_event_date_categories';

			$id_placeholders = implode( ',', array_fill( 0, count( $category_ids ), '%d' ) );

			$results = $wpdb->get_results(
				// phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- inherited_select_sql() adds 2 more %i placeholders than visible here.
				$wpdb->prepare(
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQL.NotPrepared -- inherited_select_sql() is a static internal template, not user input.
					self::inherited_select_sql() . " INNER JOIN %i edc ON ed.id = edc.event_date_id WHERE edc.term_id IN ($id_placeholders) AND COALESCE( ed.link_type, m.link_type ) != 'post' AND ed.event_id IS NULL AND ed.status = 'active' AND {$overlap_sql} GROUP BY ed.id ORDER BY ed.start_date ASC, ed.start_time ASC",
					array_merge(
						array( $table_name, $table_name, $cat_table ),
						array_map( 'intval', $category_ids ),
						$overlap_args
					)
				)
			);
		} else {
			$results = $wpdb->get_results(
				// phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- inherited_select_sql() adds 2 more %i placeholders than visible here.
				$wpdb->prepare(
					// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- inherited_select_sql() and $overlap_sql are static internal templates, not user input.
					self::inherited_select_sql() . " WHERE COALESCE( ed.link_type, m.link_type ) != 'post' AND ed.event_id IS NULL AND ed.status = 'active' AND {$overlap_sql} ORDER BY ed.start_date ASC, ed.start_time ASC",
					array_merge( array( $table_name, $table_name ), $overlap_args )
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
	 * Timing comes from the canonical keys (start_date, end_date, start_time,
	 * end_time, all_day).
	 *
	 * @param array $data Event data with timing keys plus title, link_type, external_url, rrule.
	 * @return int|false The row ID on success, false on failure.
	 */
	public static function create_standalone( $data ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$insert_data = array_merge(
			array( 'event_id' => null ),
			self::timing_columns( $data ),
			array(
				'occurrence_type' => $data['occurrence_type'] ?? 'single',
				'master_id'       => $data['master_id'] ?? null,
				'rrule'           => $data['rrule'] ?? null,
				'title'           => $data['title'],
				'external_url'    => $data['external_url'] ?? null,
				'link_type'       => $data['link_type'],
				'attendance_mode' => $data['attendance_mode'] ?? null,
				'joining_link'    => $data['joining_link'] ?? null,
			)
		);

		$format = array_merge( array( '%d' ), EventTiming::column_formats(), array( '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s' ) );

		$result = $wpdb->insert( $table_name, $insert_data, $format );

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Update event date fields by ID
	 *
	 * Timing keys are applied to the row's current timing (see
	 * EventTiming::merge()): an omitted key keeps its value and an explicit
	 * null clears it.
	 *
	 * @param int   $id   Event date row ID.
	 * @param array $data Associative array of fields to update.
	 * @return bool True on success, false on failure.
	 */
	public static function update_by_id( $id, $data ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$timing_keys = array_flip( EventTiming::KEYS );
		if ( array_intersect_key( $data, $timing_keys ) ) {
			$row = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE id = %d LIMIT 1',
					$table_name,
					$id
				)
			);

			if ( ! $row ) {
				return false;
			}

			$timing = EventTiming::merge( EventTiming::from_row( $row ), array_intersect_key( $data, $timing_keys ) );

			$data = array_merge( array_diff_key( $data, $timing_keys ), EventTiming::columns( $timing ) );
		}

		$allowed_fields = array(
			'event_id'           => '%d',
			'all_day'            => '%d',
			'start_date'         => '%s',
			'end_date'           => '%s',
			'start_time'         => '%s',
			'end_time'           => '%s',
			'dates_override'     => '%d',
			'times_override'     => '%d',
			'occurrence_type'    => '%s',
			'master_id'          => '%d',
			'rrule'              => '%s',
			'venue_id'           => '%d',
			'title'              => '%s',
			'external_url'       => '%s',
			'link_type'          => '%s',
			'attendance_mode'    => '%s',
			'joining_link'       => '%s',
			'capacity'           => '%d',
			'address'            => '%s',
			'recurrence_anchor'  => '%s',
			'status'             => '%s',
			'publication_status' => '%s',
			'recurrence_mode'    => '%s',
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

		if ( false !== $result ) {
			// Occurrences resolved later in this request must see the new values.
			unset( self::$master_cache[ (int) $id ] );

			/**
			 * Fires after an event date row is updated.
			 *
			 * Consumers (e.g. fair-audience scheduled mailings) recompute any
			 * send times anchored to this date.
			 *
			 * @param int $id Event date row ID.
			 */
			do_action( 'fair_events_event_date_updated', (int) $id );
		}

		return false !== $result;
	}

	/**
	 * Delete event date by ID
	 *
	 * Cascades to generated occurrences (rows with master_id = $id) and
	 * cleans up junction table entries.
	 *
	 * @param int $id Event date row ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_by_id( $id ) {
		global $wpdb;

		$table_name     = $wpdb->prefix . 'fair_event_dates';
		$posts_table    = $wpdb->prefix . 'fair_event_date_posts';
		$category_table = $wpdb->prefix . 'fair_event_date_categories';

		// Cascade-delete generated occurrences pointing at this row, so masters
		// don't leave orphaned children behind.
		self::delete_generated_by_master_id( $id );

		// Clean up junction table entries.
		$wpdb->delete(
			$posts_table,
			array( 'event_date_id' => $id ),
			array( '%d' )
		);
		$wpdb->delete(
			$category_table,
			array( 'event_date_id' => $id ),
			array( '%d' )
		);

		// The schedule belongs to the event date; its entries would otherwise
		// keep pointing at an event that no longer exists.
		ScheduleItem::delete_by_event_date_id( $id );

		$result = $wpdb->delete(
			$table_name,
			array( 'id' => $id ),
			array( '%d' )
		);

		if ( false !== $result ) {
			/**
			 * Fires after an event date row is deleted.
			 *
			 * Consumers (e.g. fair-audience scheduled mailings) cancel any
			 * messages anchored to this date.
			 *
			 * @param int $id Event date row ID.
			 */
			do_action( 'fair_events_event_date_deleted', (int) $id );
		}

		return false !== $result;
	}

	/**
	 * Get unlinked event dates (no linked post)
	 *
	 * Returns event dates where event_id IS NULL and occurrence_type is
	 * 'single' or 'master', latest start first.
	 *
	 * @return EventDates[] Array of EventDates objects.
	 */
	public static function get_unlinked() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE event_id IS NULL AND occurrence_type IN ('single', 'master') ORDER BY start_date DESC, start_time DESC",
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
	 * Get generated occurrences by master ID
	 *
	 * Active occurrences only by default; admin surfaces that also need
	 * cancelled rows (e.g. rendering red calendar cells) pass true.
	 *
	 * @param int  $master_id        Master event date ID.
	 * @param bool $include_cancelled Whether to include cancelled rows.
	 * @return EventDates[] Array of generated EventDates objects.
	 */
	public static function get_generated_by_master_id( $master_id, $include_cancelled = false ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$status_sql = $include_cancelled ? '' : "AND status = 'active'";

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$results = $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $status_sql is a fixed internal string, not request input.
				"SELECT * FROM %i WHERE master_id = %d AND occurrence_type = %s {$status_sql} ORDER BY start_date ASC, start_time ASC",
				$table_name,
				$master_id,
				'generated'
			)
		);

		$dates = array();
		foreach ( $results as $result ) {
			$dates[] = self::hydrate( $result );
		}

		return $dates;
	}

	/**
	 * Get all rows belonging to a recurring series (the master row itself plus
	 * every generated child), keyed by recurrence_anchor (falling back to
	 * the start date for un-backfilled rows).
	 *
	 * Used by RecurrenceService::reconcile_occurrences() to match desired
	 * occurrences against existing rows without churning IDs.
	 *
	 * @param int $master_id Master event date ID.
	 * @return array<string, EventDates> Map of anchor-date string → EventDates.
	 */
	public static function get_all_by_master_id( $master_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d OR master_id = %d ORDER BY start_date ASC, start_time ASC',
				$table_name,
				$master_id,
				$master_id
			)
		);

		$map = array();
		foreach ( $results as $result ) {
			$row    = self::hydrate( $result );
			$anchor = $row->recurrence_anchor ?? $row->start_date;

			$map[ $anchor ] = $row;
		}

		return $map;
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

		return false !== $result;
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
		$status = isset( $data['status'] ) && in_array( $data['status'], array( 'active', 'cancelled' ), true )
			? $data['status']
			: 'active';

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$insert_data = array_merge(
			array( 'event_id' => $data['event_id'] ?? null ),
			self::timing_columns( $data ),
			array(
				'occurrence_type'   => 'generated',
				'master_id'         => $data['master_id'],
				'rrule'             => null,
				'title'             => $data['title'] ?? null,
				'external_url'      => $data['external_url'] ?? null,
				'link_type'         => $data['link_type'] ?? null,
				'attendance_mode'   => $data['attendance_mode'] ?? null,
				'joining_link'      => $data['joining_link'] ?? null,
				'venue_id'          => $data['venue_id'] ?? null,
				'address'           => $data['address'] ?? null,
				'recurrence_anchor' => $data['recurrence_anchor'] ?? null,
				'status'            => $status,
			)
		);

		$format = array_merge( array( '%d' ), EventTiming::column_formats(), array( '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s' ) );

		$result = $wpdb->insert( $table_name, $insert_data, $format );

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Get the complete category selection for an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int[] Array of term IDs.
	 */
	public static function get_category_ids( $event_date_id ) {
		global $wpdb;
		$event_date = self::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return array();
		}
		$table_name = $wpdb->prefix . 'fair_event_date_categories';
		$term_ids   = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT term_id FROM %i WHERE event_date_id = %d',
				$table_name,
				$event_date_id
			)
		);
		if ( $event_date->category_selection_saved || ! empty( $term_ids ) ) {
			return array_map( 'intval', $term_ids );
		}
		if ( ! $event_date->category_selection_saved ) {
			if ( $event_date->master_id ) {
				return self::get_category_ids( $event_date->master_id );
			}
			if ( $event_date->event_id ) {
				$term_ids = wp_get_post_terms(
					$event_date->event_id,
					'category',
					array(
						'fields' => 'ids',
						'lang'   => '',
					)
				);
				if ( ! is_wp_error( $term_ids ) ) {
					self::set_category_ids( $event_date_id, $term_ids );
					return array_map( 'intval', $term_ids );
				}
			}
		}

		return array();
	}

	/**
	 * Get the complete category selection of many event dates at once.
	 *
	 * Follows get_category_ids()'s rules — a saved (possibly empty)
	 * selection, otherwise the master's, otherwise the linked post's
	 * categories — with a fixed number of queries for the whole set. Unlike
	 * get_category_ids(), it is read-only: the post-category fallback is
	 * returned without being saved for the row. Post terms are read through
	 * the object term cache, so callers prime it for the linked posts first.
	 *
	 * @param EventDates[] $rows Event date rows, as hydrated from the table.
	 * @return array<int, int[]> Term IDs keyed by row ID.
	 */
	public static function get_category_ids_for_rows( array $rows ) {
		global $wpdb;

		$by_id = array();
		foreach ( $rows as $row ) {
			$by_id[ (int) $row->id ] = $row;
		}

		// Walk up the master chain, one query per level.
		$pending = $rows;
		while ( ! empty( $pending ) ) {
			$master_ids = array();
			foreach ( $pending as $row ) {
				if ( $row->master_id && ! isset( $by_id[ (int) $row->master_id ] ) ) {
					$master_ids[ (int) $row->master_id ] = (int) $row->master_id;
				}
			}

			self::prime_master_cache( $master_ids );

			$pending = array();
			foreach ( $master_ids as $master_id ) {
				if ( ! empty( self::$master_cache[ $master_id ] ) ) {
					$by_id[ $master_id ] = self::$master_cache[ $master_id ];
					$pending[]           = self::$master_cache[ $master_id ];
				}
			}
		}

		$saved_term_ids = array();
		if ( ! empty( $by_id ) ) {
			$ids        = array_keys( $by_id );
			$table_name = $wpdb->prefix . 'fair_event_date_categories';

			$results = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT event_date_id, term_id FROM %i WHERE event_date_id IN (' . implode( ', ', array_fill( 0, count( $ids ), '%d' ) ) . ') ORDER BY event_date_id ASC, term_id ASC',
					array_merge( array( $table_name ), $ids )
				)
			);

			foreach ( (array) $results as $result ) {
				$saved_term_ids[ (int) $result->event_date_id ][] = (int) $result->term_id;
			}
		}

		$resolve = static function ( $id ) use ( &$resolve, $by_id, $saved_term_ids ) {
			if ( ! isset( $by_id[ $id ] ) ) {
				return array();
			}

			$row = $by_id[ $id ];

			if ( $row->category_selection_saved || ! empty( $saved_term_ids[ $id ] ) ) {
				return $saved_term_ids[ $id ] ?? array();
			}

			if ( $row->master_id ) {
				return $resolve( (int) $row->master_id );
			}

			if ( $row->event_id ) {
				$terms = get_the_terms( $row->event_id, 'category' );
				if ( is_array( $terms ) ) {
					return array_map( 'intval', wp_list_pluck( $terms, 'term_id' ) );
				}
			}

			return array();
		};

		$category_ids = array();
		foreach ( $rows as $row ) {
			$category_ids[ (int) $row->id ] = $resolve( (int) $row->id );
		}

		return $category_ids;
	}

	/**
	 * Replace category relationships for an event date.
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param int[] $term_ids      Category term IDs.
	 * @return bool True when every relationship was stored.
	 */
	public static function set_category_ids( $event_date_id, $term_ids ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_date_categories';
		if ( false === $wpdb->delete( $table_name, array( 'event_date_id' => $event_date_id ), array( '%d' ) ) ) {
			return false;
		}

		foreach ( array_unique( array_map( 'absint', $term_ids ) ) as $term_id ) {
			if ( ! $term_id ) {
				continue;
			}
			if ( false === $wpdb->insert(
				$table_name,
				array(
					'event_date_id' => $event_date_id,
					'term_id'       => $term_id,
				),
				array( '%d', '%d' )
			) ) {
				return false;
			}
		}

		$dates_table = $wpdb->prefix . 'fair_event_dates';
		if ( false === $wpdb->update( $dates_table, array( 'category_selection_saved' => 1 ), array( 'id' => $event_date_id ), array( '%d' ), array( '%d' ) ) ) {
			return false;
		}

		return true;
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
	 * Get the events a post is linked to, as link-owning (single or master)
	 * event date IDs.
	 *
	 * Reads both link records: the junction table and the primary `event_id`
	 * column. A consistent post resolves to exactly one event.
	 *
	 * @param int $post_id Post ID.
	 * @return int[] Unique event date IDs.
	 */
	public static function get_link_owner_ids_for_post( $post_id ) {
		global $wpdb;

		$table_name  = $wpdb->prefix . 'fair_event_dates';
		$posts_table = $wpdb->prefix . 'fair_event_date_posts';

		$ids = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT COALESCE( ed.master_id, ed.id ) FROM %i ed WHERE ed.event_id = %d
				UNION
				SELECT COALESCE( ed.master_id, ed.id ) FROM %i edp JOIN %i ed ON ed.id = edp.event_date_id WHERE edp.post_id = %d',
				$table_name,
				$post_id,
				$posts_table,
				$table_name,
				$post_id
			)
		);

		return array_values( array_unique( array_map( 'intval', $ids ) ) );
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

		return false !== $result;
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

		return false !== $result;
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

		return false !== $result;
	}


	/**
	 * Get all upcoming occurrences for a recurring event (master + generated)
	 *
	 * Returns the master row (if it is itself upcoming) along with every
	 * upcoming generated row (see EventTimingSql::upcoming(): a date missing
	 * a time stays upcoming until its end), sorted ascending.
	 *
	 * @param int $master_id Master event date ID.
	 * @return EventDates[] Array of EventDates objects, in start order.
	 */
	public static function get_upcoming_by_master_id( $master_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		list( $upcoming_sql, $upcoming_args ) = EventTimingSql::upcoming( 'ed', current_time( 'mysql' ) );

		$results = $wpdb->get_results(
			// phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- the placeholders' values are passed as one array.
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $upcoming_sql is a static internal template, not user input.
				"SELECT ed.* FROM %i ed WHERE (ed.id = %d OR ed.master_id = %d) AND ed.status = 'active' AND {$upcoming_sql} ORDER BY ed.start_date ASC, ed.start_time ASC",
				array_merge( array( $table_name, $master_id, $master_id ), $upcoming_args )
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
	 * Get the occurrence in a series that falls on a given calendar date
	 *
	 * Looks up the master row itself plus every generated child, taking the
	 * earliest start on that date if more than one occurrence shares it
	 * (rare).
	 *
	 * @param int    $master_id Master event date ID.
	 * @param string $date      Date in `Y-m-d` format.
	 * @return EventDates|null Matching occurrence, or null if none.
	 */
	public static function get_by_master_id_and_date( $master_id, $date ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$result = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE (id = %d OR master_id = %d) AND status = 'active' AND start_date = %s ORDER BY start_date ASC, start_time ASC LIMIT 1",
				$table_name,
				$master_id,
				$master_id,
				$date
			)
		);

		if ( ! $result ) {
			return null;
		}

		return self::hydrate( $result );
	}

	/**
	 * Get the next upcoming generated occurrence by master ID
	 *
	 * Efficiently queries for the single next upcoming occurrence (see
	 * EventTimingSql::upcoming()).
	 *
	 * @param int $master_id Master event date ID.
	 * @return EventDates|null Next upcoming EventDates object or null if none.
	 */
	public static function get_next_upcoming_by_master_id( $master_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		list( $upcoming_sql, $upcoming_args ) = EventTimingSql::upcoming( 'ed', current_time( 'mysql' ) );

		$result = $wpdb->get_row(
			// phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- the placeholders' values are passed as one array.
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $upcoming_sql is a static internal template, not user input.
				"SELECT ed.* FROM %i ed WHERE ed.master_id = %d AND ed.occurrence_type = %s AND ed.status = 'active' AND {$upcoming_sql} ORDER BY ed.start_date ASC, ed.start_time ASC LIMIT 1",
				array_merge( array( $table_name, $master_id, 'generated' ), $upcoming_args )
			)
		);

		if ( ! $result ) {
			return null;
		}

		return self::hydrate( $result );
	}

	/**
	 * Get event date by ID
	 *
	 * @param int $id Event date ID.
	 * @return EventDates|null EventDates object or null if not found.
	 */
	/**
	 * Get all event dates ordered by start datetime descending.
	 *
	 * @return array Array of event date objects.
	 *
	 * phpcs:disable WordPress.DB.DirectDatabaseQuery
	 */
	public static function get_all() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i ORDER BY start_date DESC, start_time DESC',
				$table_name
			)
		);

		return array_map( array( __CLASS__, 'hydrate' ), $results );
	}

	/**
	 * Get an event date by ID.
	 *
	 * @param int $id Event date ID.
	 * @return EventDates|null Event date or null when missing.
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

	/**
	 * Creation times already looked up in this request, by event date ID.
	 *
	 * @var array<int, int>
	 */
	private static $creation_timestamps = array();

	/**
	 * Resolve when an event was created, as a Unix timestamp: the row's own
	 * creation, or its series master's for a generated occurrence — the
	 * anchor of the lazy default ticket sale-period start (issue #1841).
	 *
	 * `created_at` is filled by the database's CURRENT_TIMESTAMP in the
	 * MySQL session timezone, not the site timezone, so MySQL converts it
	 * with UNIX_TIMESTAMP() rather than PHP guessing its zone. Found values
	 * are memoized per request: a row's creation time never changes.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int|null Unix timestamp, or null when the row doesn't exist or has no usable creation time.
	 */
	public static function get_creation_timestamp( $event_date_id ) {
		global $wpdb;

		$event_date_id = (int) $event_date_id;
		if ( isset( self::$creation_timestamps[ $event_date_id ] ) ) {
			return self::$creation_timestamps[ $event_date_id ];
		}

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$timestamp = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT UNIX_TIMESTAMP( COALESCE( m.created_at, ed.created_at ) )
				FROM %i ed
				LEFT JOIN %i m ON m.id = ed.master_id AND ed.occurrence_type = 'generated'
				WHERE ed.id = %d",
				$table_name,
				$table_name,
				$event_date_id
			)
		);

		if ( null === $timestamp || (int) $timestamp <= 0 ) {
			return null;
		}

		self::$creation_timestamps[ $event_date_id ] = (int) $timestamp;

		return (int) $timestamp;
	}

	/**
	 * Resolve the boundary that anchors the lazy default ticket sale-period
	 * end: the final active occurrence's end date. Only the date matters
	 * (the sale ends the day after it), so a missing end time needs no
	 * substitute; a date without an end keeps its start date as its end
	 * date (issue #1582).
	 *
	 * The "final active occurrence" is the row with the latest start among
	 * the event date's own row and its active ('active' status) generated
	 * children — a single/master row with no generated children just
	 * resolves from itself.
	 *
	 * @param int $event_date_id Event date ID (master or single row).
	 * @return string|null End date ('Y-m-d'), or null when the row doesn't exist or is undated.
	 */
	public static function get_last_occurrence_boundary( $event_date_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT start_date, end_date FROM %i
				WHERE id = %d
				OR ( master_id = %d AND status = 'active' )
				ORDER BY start_date DESC, start_time DESC
				LIMIT 1",
				$table_name,
				$event_date_id,
				$event_date_id
			)
		);

		if ( ! $row ) {
			return null;
		}

		if ( ! empty( $row->end_date ) ) {
			return $row->end_date;
		}

		return ! empty( $row->start_date ) ? $row->start_date : null;
	}
}
