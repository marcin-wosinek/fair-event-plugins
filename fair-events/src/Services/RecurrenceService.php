<?php
/**
 * Recurrence Service
 *
 * Handles RRULE parsing and occurrence generation for recurring events.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Helpers\EventTiming;
use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * Service for handling recurring events
 */
class RecurrenceService {

	/**
	 * Maximum number of occurrences to generate
	 */
	const MAX_OCCURRENCES = 100;

	/**
	 * Parse an RRULE string into an associative array
	 *
	 * @param string $rrule RRULE string (e.g., "FREQ=WEEKLY;COUNT=10").
	 * @return array Parsed RRULE components.
	 */
	public static function parse_rrule( $rrule ) {
		$result = array(
			'freq'     => null,
			'interval' => 1,
			'count'    => null,
			'until'    => null,
		);

		if ( empty( $rrule ) ) {
			return $result;
		}

		$parts = explode( ';', $rrule );

		foreach ( $parts as $part ) {
			$key_value = explode( '=', $part, 2 );
			if ( count( $key_value ) !== 2 ) {
				continue;
			}

			$key   = strtoupper( trim( $key_value[0] ) );
			$value = trim( $key_value[1] );

			switch ( $key ) {
				case 'FREQ':
					$result['freq'] = strtoupper( $value );
					break;
				case 'INTERVAL':
					$result['interval'] = max( 1, (int) $value );
					break;
				case 'COUNT':
					$result['count'] = max( 1, (int) $value );
					break;
				case 'UNTIL':
					// Parse UNTIL date (format: YYYYMMDD or YYYYMMDDTHHMMSS).
					$result['until'] = self::parse_ical_date( $value );
					break;
			}
		}

		return $result;
	}

	/**
	 * Parse iCal date format to PHP DateTime
	 *
	 * @param string $date_string iCal date string (YYYYMMDD or YYYYMMDDTHHMMSS).
	 * @return \DateTime|null DateTime object or null on failure.
	 */
	private static function parse_ical_date( $date_string ) {
		// Remove any 'Z' timezone suffix.
		$date_string = rtrim( $date_string, 'Z' );

		// Try YYYYMMDDTHHMMSS format first.
		$datetime = \DateTime::createFromFormat( 'Ymd\THis', $date_string );
		if ( $datetime ) {
			return $datetime;
		}

		// Try YYYYMMDD format.
		$datetime = \DateTime::createFromFormat( 'Ymd', $date_string );
		if ( $datetime ) {
			$datetime->setTime( 23, 59, 59 );
			return $datetime;
		}

		return null;
	}

	/**
	 * Generate occurrences based on RRULE
	 *
	 * Steps through calendar dates from the timing's start date. Every
	 * occurrence keeps the calendar-day span, the times (each still
	 * optional) and the all-day flag of `$timing` — no duration is derived
	 * from times. An UNTIL limit with a time is compared against each
	 * date's start time, or the start of that day when there is none.
	 *
	 * @param array  $timing  Canonical timing of the first occurrence (see EventTiming).
	 * @param string $rrule   RRULE string.
	 * @param int    $max     Maximum occurrences to generate.
	 * @param array  $exdates Array of excluded dates (Y-m-d format). Skipped dates still count toward COUNT limit.
	 * @return array[] Canonical timings, the first one starting on the timing's start date.
	 */
	public static function generate_occurrences( array $timing, $rrule, $max = null, $exdates = array() ) {
		if ( null === $max ) {
			$max = self::MAX_OCCURRENCES;
		}

		$parsed = self::parse_rrule( $rrule );
		$timing = array_merge( EventTiming::undated(), $timing );

		if ( empty( $parsed['freq'] ) || empty( $timing['start_date'] ) ) {
			return array();
		}

		$until = $parsed['until'] ? $parsed['until']->format( 'Y-m-d H:i:s' ) : null;
		$time  = $timing['start_time'] ?? '00:00:00';

		$occurrences = array();

		// First occurrence is the original date (this will be the master).
		$current = new \DateTime( $timing['start_date'], new \DateTimeZone( 'UTC' ) );

		$count = 0;
		$limit = $parsed['count'] ? min( $parsed['count'], $max ) : $max;

		while ( $count < $limit ) {
			$current_date = $current->format( 'Y-m-d' );

			// Check UNTIL condition.
			if ( $until && $current_date . ' ' . $time > $until ) {
				break;
			}

			// Count toward RRULE COUNT limit regardless of exclusion.
			++$count;

			// Skip excluded dates but still count them.
			if ( ! in_array( $current_date, $exdates, true ) ) {
				$occurrences[] = EventTiming::for_date( $timing, $current_date );
			}

			// Calculate next occurrence.
			$current = self::add_interval( $current, $parsed['freq'], $parsed['interval'] );
		}

		return $occurrences;
	}

	/**
	 * Add interval to a date based on frequency
	 *
	 * @param \DateTime $date     The date to modify.
	 * @param string    $freq     Frequency (DAILY, WEEKLY, MONTHLY).
	 * @param int       $interval Interval multiplier.
	 * @return \DateTime Modified date.
	 */
	private static function add_interval( $date, $freq, $interval ) {
		$new_date = clone $date;

		switch ( $freq ) {
			case 'DAILY':
				$new_date->modify( "+{$interval} days" );
				break;
			case 'WEEKLY':
				$new_date->modify( "+{$interval} weeks" );
				break;
			case 'MONTHLY':
				$new_date->modify( "+{$interval} months" );
				break;
			case 'YEARLY':
				$new_date->modify( "+{$interval} years" );
				break;
		}

		return $new_date;
	}

	/**
	 * Regenerate all occurrences for an event
	 *
	 * Uses reconcile_occurrences() so existing row IDs are preserved when
	 * dates shift, avoiding id-churn that breaks attached ticket types and signups.
	 *
	 * @param int           $event_id Event post ID.
	 * @param string|null   $rrule          Optional RRULE to use. Pass null to read from database,
	 *                                      pass empty string to explicitly clear recurrence.
	 * @param string[]|null $excluded_dates Complete list of scheduled dates (Y-m-d) to keep cancelled.
	 *                                      Null restores every scheduled date, as before.
	 * @return int|false Number of active occurrences, or false when a row could not be written.
	 */
	public static function regenerate_event_occurrences( $event_id, $rrule = null, $excluded_dates = null ) {
		$master = EventDates::get_by_event_id( $event_id );

		if ( ! $master ) {
			return 0;
		}

		if ( null === $rrule ) {
			$rrule = EventDates::get_rrule_by_event_id( $event_id );
		}

		if ( empty( $rrule ) ) {
			// No recurrence: mark the series 'none'. Only wipe children when the
			// series is actually transitioning out of rule-based recurrence —
			// an already-'none' master has nothing to wipe (an empty rrule alone
			// is never itself a reason to delete children).
			if ( 'none' !== $master->recurrence_mode ) {
				EventDates::delete_generated_occurrences( $event_id );
			}
			EventDates::save_or_update_master(
				$event_id,
				$master->get_timing(),
				null,
				null,
				'single',
				null,
				'none'
			);
			return 1;
		}

		$occurrences = self::generate_occurrences( $master->get_timing(), $rrule );

		if ( empty( $occurrences ) ) {
			return 0;
		}

		// Ensure master row exists / is up to date with the new rrule and first occurrence time.
		$master_id = EventDates::save_or_update_master(
			$event_id,
			$occurrences[0],
			null,
			null,
			'master',
			$rrule,
			'rule'
		);

		if ( ! $master_id ) {
			return 0;
		}

		// Reconcile generated children (occurrences[1..n]) against existing rows.
		// Inheritable fields (title, venue_id, address, link_type, external_url,
		// capacity, attendance_mode, joining_link) are NOT propagated here — instances hold NULL
		// for them unless explicitly overridden, and resolve against the master
		// at read time.
		$generated  = array_slice( $occurrences, 1 );
		$reconciled = self::reconcile_occurrences(
			$master_id,
			$generated,
			array( 'event_id' => $event_id ),
			$excluded_dates
		);

		return false === $reconciled ? false : 1 + $reconciled;
	}

	/**
	 * Regenerate occurrences for a standalone event date (no linked post)
	 *
	 * Uses reconcile_occurrences() to preserve existing row IDs.
	 *
	 * @param int           $event_date_id Event date row ID.
	 * @param string|null   $rrule          RRULE string. Pass null to read from DB,
	 *                                      empty string to clear recurrence.
	 * @param string[]|null $excluded_dates Complete list of scheduled dates (Y-m-d) to keep cancelled.
	 *                                      Null restores every scheduled date, as before.
	 * @return int|false Number of active occurrences, or false when a row could not be written.
	 */
	public static function regenerate_standalone_occurrences( $event_date_id, $rrule = null, $excluded_dates = null ) {
		$master = EventDates::get_by_id( $event_date_id );

		if ( ! $master ) {
			return 0;
		}

		if ( null === $rrule ) {
			$rrule = $master->rrule;
		}

		if ( empty( $rrule ) ) {
			// An empty rrule alone is never itself a reason to delete children —
			// only wipe when the series is actually leaving rule-based recurrence.
			if ( 'none' !== $master->recurrence_mode ) {
				EventDates::delete_generated_by_master_id( $event_date_id );
			}
			EventDates::update_by_id(
				$event_date_id,
				array(
					'occurrence_type' => 'single',
					'rrule'           => null,
					'recurrence_mode' => 'none',
				)
			);
			return 1;
		}

		$occurrences = self::generate_occurrences( $master->get_timing(), $rrule );

		if ( empty( $occurrences ) ) {
			return 0;
		}

		// Update master row time and mark as master (first occurrence is the master itself).
		$first = $occurrences[0];
		EventDates::update_by_id(
			$event_date_id,
			array_merge(
				$first,
				array(
					'occurrence_type'   => 'master',
					'rrule'             => $rrule,
					'recurrence_mode'   => 'rule',
					'recurrence_anchor' => $first['start_date'],
				)
			)
		);

		// Inheritable fields are NOT propagated here — see regenerate_event_occurrences().
		$generated  = array_slice( $occurrences, 1 );
		$reconciled = self::reconcile_occurrences(
			$event_date_id,
			$generated,
			array( 'event_id' => $master->event_id ),
			$excluded_dates
		);

		return false === $reconciled ? false : 1 + $reconciled;
	}

	/**
	 * Build the occurrence set for a hand-picked list of dates.
	 *
	 * Pure — no DB access. Each date takes the reference timing's day span,
	 * times and all-day flag, as generate_occurrences() does. Dates are
	 * deduplicated and sorted ascending so the first is always the earliest.
	 *
	 * @param array    $timing Reference canonical timing (see EventTiming).
	 * @param string[] $dates  Occurrence dates (Y-m-d), any order, may contain duplicates.
	 * @return array[] Canonical timings, sorted ascending.
	 */
	public static function build_manual_occurrences( array $timing, array $dates ) {
		$dates = array_values( array_unique( $dates ) );
		sort( $dates );

		$occurrences = array();
		foreach ( $dates as $date ) {
			$occurrences[] = EventTiming::for_date( $timing, $date );
		}

		return $occurrences;
	}

	/**
	 * Set a series to a hand-picked (manual) list of occurrence dates.
	 *
	 * Uses reconcile_occurrences() so existing row IDs are preserved when
	 * dates shift, same as the RRULE paths above. The earliest date becomes
	 * the master; when only one date remains, the series collapses to a
	 * plain 'none' single occurrence rather than a one-item manual series.
	 *
	 * @param int      $master_id Master (or single) event date row ID.
	 * @param string[] $dates     Occurrence dates (Y-m-d).
	 * @return int Number of occurrences set (master + surviving children).
	 */
	public static function set_manual_occurrences( $master_id, array $dates ) {
		$master = EventDates::get_by_id( $master_id );

		if ( ! $master ) {
			return 0;
		}

		$occurrences = self::build_manual_occurrences( $master->get_timing(), $dates );

		if ( empty( $occurrences ) ) {
			return 0;
		}

		$is_single = 1 === count( $occurrences );
		$first     = $occurrences[0];

		EventDates::update_by_id(
			$master_id,
			array_merge(
				$first,
				array(
					'occurrence_type'   => $is_single ? 'single' : 'master',
					'rrule'             => null,
					'recurrence_mode'   => $is_single ? 'none' : 'manual',
					'recurrence_anchor' => $first['start_date'],
				)
			)
		);

		// Inheritable fields are NOT propagated here — see regenerate_event_occurrences().
		$generated = array_slice( $occurrences, 1 );
		return 1 + self::reconcile_occurrences(
			$master_id,
			$generated,
			array( 'event_id' => $master->event_id )
		);
	}

	/**
	 * Reconcile generated occurrences for a series against the desired set.
	 *
	 * Matches desired occurrences to existing generated rows (active or
	 * cancelled) by anchor date, then:
	 * - Updates rows whose anchor matches (preserves id); a cancelled row whose
	 *   anchor reappears in the desired set is restored to active. Only the
	 *   timing groups the row does not override are rewritten (see
	 *   EventTiming::OVERRIDE_GROUPS), so an occurrence edited on its own
	 *   keeps its dates or times through series changes.
	 * - Inserts rows for new anchors.
	 * - Keeps the desired anchors listed in $cancelled_anchors as cancelled rows
	 *   (inserting them when missing), so a date the organizer excluded from the
	 *   schedule stays part of it and can be restored later.
	 * - Soft-cancels (status='cancelled') rows whose anchor is no longer in the
	 *   desired set instead of deleting them, so dependents (ticket types,
	 *   signups) survive and the occurrence can come back if the anchor
	 *   reappears later.
	 *
	 * Inheritable instance fields (title, venue_id, address, link_type,
	 * external_url, capacity, attendance_mode, joining_link) are never stamped here — instances
	 * hold NULL for them unless explicitly overridden, and resolve against the
	 * master at read time.
	 *
	 * @param int           $master_id         Master event date row ID.
	 * @param array[]       $desired           Desired generated occurrences — canonical timings.
	 * @param array         $master_props      Non-inherited fields to copy onto children (currently just event_id).
	 * @param string[]|null $cancelled_anchors Desired anchors (Y-m-d) that must be cancelled. Null means
	 *                                         every desired anchor is active.
	 * @return int|false Number of active generated children, or false when a row could not be written.
	 */
	public static function reconcile_occurrences( $master_id, $desired, $master_props = array(), $cancelled_anchors = null ) {
		$cancelled_anchors  = array_fill_keys( (array) $cancelled_anchors, true );
		$desired_by_anchor  = self::key_by_anchor( $desired );
		$existing_by_anchor = self::get_generated_by_anchor( $master_id );

		$count = 0;

		foreach ( $desired_by_anchor as $anchor => $occ ) {
			$status = isset( $cancelled_anchors[ $anchor ] ) ? 'cancelled' : 'active';

			if ( isset( $existing_by_anchor[ $anchor ] ) ) {
				// Match — update in place, preserving id. Inheritable fields
				// (title, venue_id, address, link_type, external_url,
				// capacity, attendance_mode, joining_link) are intentionally NOT touched: instances hold
				// NULL for them unless explicitly overridden, and resolve
				// against the master at read time.
				$row    = $existing_by_anchor[ $anchor ];
				$update = array_merge(
					EventTiming::resolve_occurrence( $occ, $anchor, $row->get_timing(), $row->timing_overrides ),
					array( 'recurrence_anchor' => $anchor )
				);
				if ( array_key_exists( 'event_id', $master_props ) ) {
					$update['event_id'] = $master_props['event_id'];
				}
				// Every desired anchor is active unless it is excluded. This restores
				// soft-cancelled rows on regrow and repairs any unsupported legacy status.
				if ( $status !== $row->status ) {
					$update['status'] = $status;
				}
				if ( ! EventDates::update_by_id( $row->id, $update ) ) {
					return false;
				}
				unset( $existing_by_anchor[ $anchor ] );
			} else {
				// New anchor — insert.
				if ( ! empty( $master_props['event_id'] ) ) {
					$inserted = EventDates::save_occurrence(
						$master_props['event_id'],
						$occ,
						null,
						null,
						'generated',
						$master_id,
						$anchor,
						$status
					);
				} else {
					$inserted = EventDates::create_standalone_occurrence(
						array_merge(
							$occ,
							array(
								'master_id'         => $master_id,
								'recurrence_anchor' => $anchor,
								'status'            => $status,
							)
						)
					);
				}
				if ( ! $inserted ) {
					return false;
				}
			}

			if ( 'active' === $status ) {
				++$count;
			}
		}

		// Soft-cancel rows whose anchor is no longer in the desired set instead
		// of deleting them — dependents (ticket types, signups) survive, and the
		// occurrence can come back active if the anchor reappears later.
		foreach ( $existing_by_anchor as $stale_row ) {
			if ( 'cancelled' !== $stale_row->status
				&& ! EventDates::update_by_id( $stale_row->id, array( 'status' => 'cancelled' ) )
			) {
				return false;
			}
		}

		return $count;
	}

	/**
	 * Find active occurrences whose overrides cannot combine with a proposed
	 * schedule.
	 *
	 * An occurrence overriding its dates still inherits its series' times,
	 * and the reverse; a series change can make that combination invalid,
	 * e.g. overnight times (22:00 to 02:00) on an occurrence moved to a
	 * single day. Such a change must not be applied until the occurrence is
	 * adjusted or reset.
	 *
	 * @param int     $master_id          Master event date row ID.
	 * @param array[] $proposed_generated Desired generated occurrences — canonical timings.
	 * @return array[] Conflicts, each with 'id', 'start_date' and 'reason' (an EventTiming error code).
	 */
	public static function find_override_conflicts( $master_id, $proposed_generated ) {
		$existing  = self::get_generated_by_anchor( $master_id );
		$conflicts = array();

		foreach ( self::key_by_anchor( $proposed_generated ) as $anchor => $occ ) {
			$row = $existing[ $anchor ] ?? null;
			if ( ! $row || 'cancelled' === $row->status || ! in_array( true, $row->timing_overrides, true ) ) {
				continue;
			}

			$error = EventTiming::validate( EventTiming::resolve_occurrence( $occ, $anchor, $row->get_timing(), $row->timing_overrides ) );
			if ( $error ) {
				$conflicts[] = array(
					'id'         => (int) $row->id,
					'start_date' => $row->start_date,
					'reason'     => $error,
				);
			}
		}

		return $conflicts;
	}

	/**
	 * Key canonical timings by their anchor (start) date.
	 *
	 * @param array[] $occurrences Canonical timings.
	 * @return array<string, array> Timings keyed by start date.
	 */
	private static function key_by_anchor( $occurrences ) {
		$by_anchor = array();
		foreach ( $occurrences as $occ ) {
			$by_anchor[ $occ['start_date'] ] = $occ;
		}
		return $by_anchor;
	}

	/**
	 * A series' generated rows (active and cancelled) keyed by anchor, without
	 * the master row itself.
	 *
	 * @param int $master_id Master event date row ID.
	 * @return array<string, EventDates> Rows keyed by anchor date.
	 */
	private static function get_generated_by_anchor( $master_id ) {
		return array_filter(
			EventDates::get_all_by_master_id( $master_id ),
			static function ( $row ) use ( $master_id ) {
				return (int) $row->id !== (int) $master_id;
			}
		);
	}

	/**
	 * Classify the impact of a proposed recurrence regeneration on generated children.
	 *
	 * Compares the desired generated occurrence set against existing DB rows (keyed
	 * by anchor) and returns a partition into unchanged / shifted / added / removed.
	 * A row's proposed timing keeps its overridden groups, so an occurrence
	 * whose own times survive the change is unchanged. Each entry in
	 * 'shifted' and 'removed' includes a 'dependents' count (ticket types +
	 * active signups) and an 'is_past' flag.
	 *
	 * Only classifies generated children — the master row is always preserved.
	 * Pass the active occurrences only: a cancelled row that becomes active again
	 * counts as added, and one that stays out of the active set is not a change.
	 *
	 * Entries carry `start_date` / `start_time` (and `new_start_date` /
	 * `new_start_time` when shifted) next to the deprecated `start_datetime`
	 * (and `new_start_datetime`).
	 *
	 * @param int     $master_id          Master event date row ID.
	 * @param array[] $proposed_generated Desired generated occurrences (slice after first) — canonical timings.
	 * @return array {
	 *     @type array $unchanged  Rows that would remain identical.
	 *     @type array $shifted    Rows that would be updated in place (anchor matches, timing differs).
	 *     @type array $added      New anchors with no existing row.
	 *     @type array $removed    Existing rows whose anchor is no longer desired.
	 * }
	 */
	public static function classify_change( $master_id, $proposed_generated ) {
		$all_existing = self::get_generated_by_anchor( $master_id );

		$now = current_time( 'mysql' );

		$result = array(
			'unchanged' => array(),
			'shifted'   => array(),
			'added'     => array(),
			'removed'   => array(),
		);

		foreach ( self::key_by_anchor( $proposed_generated ) as $anchor => $occ ) {
			if ( isset( $all_existing[ $anchor ] ) && 'cancelled' !== $all_existing[ $anchor ]->status ) {
				$row      = $all_existing[ $anchor ];
				$current  = $row->get_timing();
				$proposed = EventTiming::resolve_occurrence( $occ, $anchor, $current, $row->timing_overrides );

				if ( $proposed === $current ) {
					$result['unchanged'][] = array(
						'id'             => $row->id,
						'start_datetime' => $row->start_datetime,
						'start_date'     => $row->start_date,
						'start_time'     => $row->start_time,
					);
				} else {
					$result['shifted'][] = array(
						'id'                 => $row->id,
						'start_datetime'     => $row->start_datetime,
						'start_date'         => $row->start_date,
						'start_time'         => $row->start_time,
						'new_start_datetime' => EventTiming::to_legacy( $proposed )['start_datetime'],
						'new_start_date'     => $proposed['start_date'],
						'new_start_time'     => $proposed['start_time'],
						'is_past'            => $row->start_datetime < $now,
						'dependents'         => self::count_dependents( $row->id ),
					);
				}
			} else {
				$result['added'][] = array(
					'start_datetime' => EventTiming::to_legacy( $occ )['start_datetime'],
					'start_date'     => $occ['start_date'],
					'start_time'     => $occ['start_time'],
				);
			}
			unset( $all_existing[ $anchor ] );
		}

		foreach ( $all_existing as $stale_row ) {
			if ( 'cancelled' === $stale_row->status ) {
				continue;
			}
			$result['removed'][] = array(
				'id'             => $stale_row->id,
				'start_datetime' => $stale_row->start_datetime,
				'start_date'     => $stale_row->start_date,
				'start_time'     => $stale_row->start_time,
				'is_past'        => $stale_row->start_datetime < $now,
				'dependents'     => self::count_dependents( $stale_row->id ),
			);
		}

		return $result;
	}

	/**
	 * Count active dependents for an event date.
	 *
	 * Counts ticket types and active signups (status not 'cancelled') that
	 * reference the given event date. Passes the raw count through the
	 * 'fair_events_event_date_dependents' filter so other plugins
	 * (fair-audience, fair-payments) can add their own references.
	 *
	 * @param int $event_date_id Event date row ID.
	 * @return int Total dependent count.
	 *
	 * phpcs:disable WordPress.DB.DirectDatabaseQuery
	 */
	public static function count_dependents( $event_date_id ) {
		global $wpdb;

		$tt_count = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE event_date_id = %d',
				$wpdb->prefix . 'fair_events_ticket_types',
				(int) $event_date_id
			)
		);

		$signup_count = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i WHERE event_date_id = %d AND status != 'cancelled'",
				$wpdb->prefix . 'fair_events_signups',
				(int) $event_date_id
			)
		);

		$count = $tt_count + $signup_count;

		/**
		 * Filters the dependent count for an event date.
		 *
		 * Allows other plugins (fair-audience for participant/mailing counts,
		 * fair-payments for transaction counts) to register their own references
		 * so the impact classifier can detect all dependents without a hard
		 * cross-plugin dependency.
		 *
		 * @param int $count         Raw count from fair-events own tables.
		 * @param int $event_date_id Event date row ID.
		 */
		return (int) apply_filters( 'fair_events_event_date_dependents', $count, (int) $event_date_id );
	}


	/**
	 * Build an RRULE string from components
	 *
	 * The daily/weekly/biweekly/monthly ↔ FREQ/INTERVAL vocabulary is mirrored
	 * in JS by `fair-events-shared/src/recurrence.js` (`buildRRule`/`parseRRule`).
	 * Keep both in sync when adding or changing frequencies.
	 *
	 * @param string      $frequency Frequency (DAILY, WEEKLY, MONTHLY).
	 * @param int         $interval  Interval (1 for weekly, 2 for biweekly, etc.).
	 * @param string      $end_type  End type ('count' or 'until').
	 * @param int|null    $count     Number of occurrences (if end_type is 'count').
	 * @param string|null $until     End date (if end_type is 'until', format: Y-m-d).
	 * @return string RRULE string.
	 */
	public static function build_rrule( $frequency, $interval = 1, $end_type = 'count', $count = null, $until = null ) {
		$parts = array( 'FREQ=' . strtoupper( $frequency ) );

		if ( $interval > 1 ) {
			$parts[] = 'INTERVAL=' . $interval;
		}

		if ( 'count' === $end_type && $count ) {
			$parts[] = 'COUNT=' . $count;
		} elseif ( 'until' === $end_type && $until ) {
			// Convert Y-m-d to YYYYMMDD.
			$until_formatted = str_replace( '-', '', $until );
			$parts[]         = 'UNTIL=' . $until_formatted;
		}

		return implode( ';', $parts );
	}
}
