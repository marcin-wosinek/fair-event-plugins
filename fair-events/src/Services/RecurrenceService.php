<?php
/**
 * Recurrence Service
 *
 * Handles RRULE parsing and occurrence generation for recurring events.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

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
	 * @param string $start_datetime Start datetime (Y-m-d H:i:s or Y-m-d\TH:i).
	 * @param string $end_datetime   End datetime (Y-m-d H:i:s or Y-m-d\TH:i).
	 * @param string $rrule          RRULE string.
	 * @param int    $max            Maximum occurrences to generate.
	 * @param array  $exdates        Array of excluded dates (Y-m-d format). Skipped dates still count toward COUNT limit.
	 * @return array Array of occurrences with 'start' and 'end' keys.
	 */
	public static function generate_occurrences( $start_datetime, $end_datetime, $rrule, $max = null, $exdates = array() ) {
		if ( null === $max ) {
			$max = self::MAX_OCCURRENCES;
		}

		$parsed = self::parse_rrule( $rrule );

		if ( empty( $parsed['freq'] ) ) {
			return array();
		}

		// Calculate duration between start and end.
		$start    = new \DateTime( $start_datetime );
		$end      = new \DateTime( $end_datetime );
		$duration = $start->diff( $end );

		$occurrences = array();

		// First occurrence is the original date (this will be the master).
		$current_start = clone $start;

		$count = 0;
		$limit = $parsed['count'] ? min( $parsed['count'], $max ) : $max;

		while ( $count < $limit ) {
			// Check UNTIL condition.
			if ( $parsed['until'] && $current_start > $parsed['until'] ) {
				break;
			}

			// Count toward RRULE COUNT limit regardless of exclusion.
			++$count;

			$current_date = $current_start->format( 'Y-m-d' );

			// Skip excluded dates but still count them.
			if ( ! in_array( $current_date, $exdates, true ) ) {
				// Calculate end for this occurrence.
				$current_end = clone $current_start;
				$current_end->add( $duration );

				$occurrences[] = array(
					'start' => $current_start->format( 'Y-m-d\TH:i:s' ),
					'end'   => $current_end->format( 'Y-m-d\TH:i:s' ),
				);
			}

			// Calculate next occurrence.
			$current_start = self::add_interval( $current_start, $parsed['freq'], $parsed['interval'] );
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
	 * @param int         $event_id Event post ID.
	 * @param string|null $rrule    Optional RRULE to use. Pass null to read from database,
	 *                              pass empty string to explicitly clear recurrence.
	 * @return int Number of occurrences generated.
	 */
	public static function regenerate_event_occurrences( $event_id, $rrule = null ) {
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
				$master->start_datetime,
				$master->end_datetime,
				$master->all_day,
				'single',
				null,
				'none'
			);
			return 1;
		}

		$occurrences = self::generate_occurrences(
			$master->start_datetime,
			$master->end_datetime,
			$rrule
		);

		if ( empty( $occurrences ) ) {
			return 0;
		}

		// Ensure master row exists / is up to date with the new rrule and first occurrence time.
		$first     = $occurrences[0];
		$master_id = EventDates::save_or_update_master(
			$event_id,
			$first['start'],
			$first['end'],
			$master->all_day,
			'master',
			$rrule,
			'rule'
		);

		if ( ! $master_id ) {
			return 0;
		}

		// Reconcile generated children (occurrences[1..n]) against existing rows.
		// Inheritable fields (title, venue_id, address, link_type, external_url,
		// capacity, signup_price) are NOT propagated here — instances hold NULL
		// for them unless explicitly overridden, and resolve against the master
		// at read time.
		$generated = array_slice( $occurrences, 1 );
		return 1 + self::reconcile_occurrences(
			$master_id,
			$generated,
			$master->all_day,
			array( 'event_id' => $event_id )
		);
	}

	/**
	 * Regenerate occurrences for a standalone event date (no linked post)
	 *
	 * Uses reconcile_occurrences() to preserve existing row IDs.
	 *
	 * @param int         $event_date_id Event date row ID.
	 * @param string|null $rrule         RRULE string. Pass null to read from DB,
	 *                                   empty string to clear recurrence.
	 * @return int Number of occurrences generated.
	 */
	public static function regenerate_standalone_occurrences( $event_date_id, $rrule = null ) {
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

		$occurrences = self::generate_occurrences(
			$master->start_datetime,
			$master->end_datetime,
			$rrule
		);

		if ( empty( $occurrences ) ) {
			return 0;
		}

		// Update master row time and mark as master (first occurrence is the master itself).
		$first = $occurrences[0];
		EventDates::update_by_id(
			$event_date_id,
			array(
				'occurrence_type'   => 'master',
				'rrule'             => $rrule,
				'recurrence_mode'   => 'rule',
				'start_datetime'    => $first['start'],
				'end_datetime'      => $first['end'],
				'recurrence_anchor' => ( new \DateTime( $first['start'] ) )->format( 'Y-m-d' ),
			)
		);

		// Inheritable fields are NOT propagated here — see regenerate_event_occurrences().
		$generated = array_slice( $occurrences, 1 );
		return 1 + self::reconcile_occurrences(
			$event_date_id,
			$generated,
			$master->all_day,
			array( 'event_id' => $master->event_id )
		);
	}

	/**
	 * Reconcile generated occurrences for a series against the desired set.
	 *
	 * Matches desired occurrences to existing generated rows (active or
	 * cancelled) by anchor date, then:
	 * - Updates rows whose anchor matches (preserves id); a cancelled row whose
	 *   anchor reappears in the desired set is restored to active.
	 * - Inserts rows for new anchors.
	 * - Soft-cancels (status='cancelled') rows whose anchor is no longer in the
	 *   desired set instead of deleting them, so dependents (ticket types,
	 *   signups) survive and the occurrence can come back if the anchor
	 *   reappears later.
	 *
	 * Inheritable instance fields (title, venue_id, address, link_type,
	 * external_url, capacity, signup_price) are never stamped here — instances
	 * hold NULL for them unless explicitly overridden, and resolve against the
	 * master at read time.
	 *
	 * @param int   $master_id    Master event date row ID.
	 * @param array $desired      Desired generated occurrences — each entry has 'start' and 'end' keys.
	 * @param bool  $all_day      All-day flag to apply to inserted/updated rows.
	 * @param array $master_props Non-inherited fields to copy onto children (currently just event_id).
	 * @return int Number of surviving generated children (updated + inserted).
	 */
	public static function reconcile_occurrences( $master_id, $desired, $all_day, $master_props = array() ) {
		// Build the desired set keyed by anchor date.
		$desired_by_anchor = array();
		foreach ( $desired as $occ ) {
			$anchor                       = ( new \DateTime( $occ['start'] ) )->format( 'Y-m-d' );
			$desired_by_anchor[ $anchor ] = $occ;
		}

		// Load existing generated rows keyed by anchor.
		$existing_by_anchor = EventDates::get_all_by_master_id( $master_id );
		// Remove the master row itself — reconcile only touches generated children.
		unset(
			$existing_by_anchor[ ( new \DateTime(
				EventDates::get_by_id( $master_id )->start_datetime
			) )->format( 'Y-m-d' ) ]
		);

		$count = 0;

		foreach ( $desired_by_anchor as $anchor => $occ ) {
			if ( isset( $existing_by_anchor[ $anchor ] ) ) {
				// Match — update in place, preserving id. Inheritable fields
				// (title, venue_id, address, link_type, external_url, capacity,
				// signup_price) are intentionally NOT touched: instances hold
				// NULL for them unless explicitly overridden, and resolve
				// against the master at read time.
				$row    = $existing_by_anchor[ $anchor ];
				$update = array(
					'start_datetime'    => $occ['start'],
					'end_datetime'      => $occ['end'],
					'all_day'           => $all_day ? 1 : 0,
					'recurrence_anchor' => $anchor,
				);
				if ( array_key_exists( 'event_id', $master_props ) ) {
					$update['event_id'] = $master_props['event_id'];
				}
				// Restore on regrow: a previously soft-cancelled anchor that's
				// back in the desired set becomes active again.
				if ( 'cancelled' === $row->status ) {
					$update['status'] = 'active';
				}
				EventDates::update_by_id( $row->id, $update );
				unset( $existing_by_anchor[ $anchor ] );
				++$count;
			} else {
				// New anchor — insert.
				if ( ! empty( $master_props['event_id'] ) ) {
					EventDates::save_occurrence(
						$master_props['event_id'],
						$occ['start'],
						$occ['end'],
						$all_day,
						'generated',
						$master_id,
						$anchor
					);
				} else {
					EventDates::create_standalone_occurrence(
						array(
							'start_datetime'    => $occ['start'],
							'end_datetime'      => $occ['end'],
							'all_day'           => $all_day,
							'master_id'         => $master_id,
							'recurrence_anchor' => $anchor,
						)
					);
				}
				++$count;
			}
		}

		// Soft-cancel rows whose anchor is no longer in the desired set instead
		// of deleting them — dependents (ticket types, signups) survive, and the
		// occurrence can come back active if the anchor reappears later.
		foreach ( $existing_by_anchor as $stale_row ) {
			if ( 'cancelled' !== $stale_row->status ) {
				EventDates::update_by_id( $stale_row->id, array( 'status' => 'cancelled' ) );
			}
		}

		return $count;
	}

	/**
	 * Classify the impact of a proposed recurrence regeneration on generated children.
	 *
	 * Compares the desired generated occurrence set against existing DB rows (keyed
	 * by anchor) and returns a partition into unchanged / shifted / added / removed.
	 * Each entry in 'shifted' and 'removed' includes a 'dependents' count (ticket
	 * types + active signups) and an 'is_past' flag.
	 *
	 * Only classifies generated children — the master row is always preserved.
	 *
	 * @param int   $master_id         Master event date row ID.
	 * @param array $proposed_generated Desired generated occurrences (slice after first);
	 *                                  each entry has 'start' and 'end' keys.
	 * @return array {
	 *     @type array $unchanged  Rows that would remain identical.
	 *     @type array $shifted    Rows that would be updated in place (anchor matches, times differ).
	 *     @type array $added      New anchors with no existing row.
	 *     @type array $removed    Existing rows whose anchor is no longer desired.
	 * }
	 */
	public static function classify_change( $master_id, $proposed_generated ) {
		$desired_by_anchor = array();
		foreach ( $proposed_generated as $occ ) {
			$anchor                       = ( new \DateTime( $occ['start'] ) )->format( 'Y-m-d' );
			$desired_by_anchor[ $anchor ] = $occ;
		}

		$all_existing  = EventDates::get_all_by_master_id( $master_id );
		$master_row    = EventDates::get_by_id( $master_id );
		$master_anchor = $master_row->recurrence_anchor
			?? ( new \DateTime( $master_row->start_datetime ) )->format( 'Y-m-d' );
		unset( $all_existing[ $master_anchor ] );

		$now = current_time( 'mysql' );

		$result = array(
			'unchanged' => array(),
			'shifted'   => array(),
			'added'     => array(),
			'removed'   => array(),
		);

		foreach ( $desired_by_anchor as $anchor => $occ ) {
			if ( isset( $all_existing[ $anchor ] ) ) {
				$row            = $all_existing[ $anchor ];
				$existing_start = ( new \DateTime( $row->start_datetime ) )->format( 'Y-m-d\TH:i:s' );
				$proposed_start = ( new \DateTime( $occ['start'] ) )->format( 'Y-m-d\TH:i:s' );

				if ( $existing_start === $proposed_start ) {
					$result['unchanged'][] = array(
						'id'             => $row->id,
						'start_datetime' => $row->start_datetime,
					);
				} else {
					$result['shifted'][] = array(
						'id'                 => $row->id,
						'start_datetime'     => $row->start_datetime,
						'new_start_datetime' => $occ['start'],
						'is_past'            => $row->start_datetime < $now,
						'dependents'         => self::count_dependents( $row->id ),
					);
				}
				unset( $all_existing[ $anchor ] );
			} else {
				$result['added'][] = array(
					'start_datetime' => $occ['start'],
				);
			}
		}

		foreach ( $all_existing as $stale_row ) {
			$result['removed'][] = array(
				'id'             => $stale_row->id,
				'start_datetime' => $stale_row->start_datetime,
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
