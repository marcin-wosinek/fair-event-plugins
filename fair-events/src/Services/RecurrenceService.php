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
			// No recurrence: delete generated children and mark master as 'single'.
			EventDates::delete_generated_occurrences( $event_id );
			EventDates::save_or_update_master(
				$event_id,
				$master->start_datetime,
				$master->end_datetime,
				$master->all_day,
				'single',
				null
			);
			return 1;
		}

		$exdates     = self::parse_exdates( $master->exdates );
		$occurrences = self::generate_occurrences(
			$master->start_datetime,
			$master->end_datetime,
			$rrule,
			null,
			$exdates
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
			$rrule
		);

		if ( ! $master_id ) {
			return 0;
		}

		// Reconcile generated children (occurrences[1..n]) against existing rows.
		$generated = array_slice( $occurrences, 1 );
		return 1 + self::reconcile_occurrences(
			$master_id,
			$generated,
			$master->all_day,
			array(
				'event_id'     => $event_id,
				'link_type'    => $master->link_type,
				'external_url' => $master->external_url,
				'venue_id'     => $master->venue_id,
				'address'      => $master->address,
				'title'        => $master->title,
			)
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
			EventDates::delete_generated_by_master_id( $event_date_id );
			EventDates::update_by_id(
				$event_date_id,
				array(
					'occurrence_type' => 'single',
					'rrule'           => null,
				)
			);
			return 1;
		}

		$exdates     = self::parse_exdates( $master->exdates );
		$occurrences = self::generate_occurrences(
			$master->start_datetime,
			$master->end_datetime,
			$rrule,
			null,
			$exdates
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
				'start_datetime'    => $first['start'],
				'end_datetime'      => $first['end'],
				'recurrence_anchor' => ( new \DateTime( $first['start'] ) )->format( 'Y-m-d' ),
			)
		);

		$generated = array_slice( $occurrences, 1 );
		return 1 + self::reconcile_occurrences(
			$event_date_id,
			$generated,
			$master->all_day,
			array(
				'event_id'     => $master->event_id,
				'link_type'    => $master->link_type,
				'external_url' => $master->external_url,
				'venue_id'     => $master->venue_id,
				'address'      => $master->address,
				'title'        => $master->title,
			)
		);
	}

	/**
	 * Reconcile generated occurrences for a series against the desired set.
	 *
	 * Matches desired occurrences to existing generated rows by anchor date, then:
	 * - Updates rows whose anchor matches (preserves id).
	 * - Inserts rows for new anchors.
	 * - Deletes rows whose anchor is no longer in the desired set via
	 *   EventDates::delete_by_id() so the fair_events_event_date_deleted hook fires.
	 *
	 * @param int   $master_id    Master event date row ID.
	 * @param array $desired      Desired generated occurrences — each entry has 'start' and 'end' keys.
	 * @param bool  $all_day      All-day flag to apply to inserted/updated rows.
	 * @param array $master_props Inherited fields (event_id, link_type, external_url, venue_id, address, title).
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
				// Match — update in place, preserving id.
				$row    = $existing_by_anchor[ $anchor ];
				$update = array(
					'start_datetime'    => $occ['start'],
					'end_datetime'      => $occ['end'],
					'all_day'           => $all_day ? 1 : 0,
					'recurrence_anchor' => $anchor,
				);
				foreach ( array( 'event_id', 'link_type', 'external_url', 'venue_id', 'address', 'title' ) as $field ) {
					if ( array_key_exists( $field, $master_props ) ) {
						$update[ $field ] = $master_props[ $field ];
					}
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
						array_merge(
							$master_props,
							array(
								'start_datetime'    => $occ['start'],
								'end_datetime'      => $occ['end'],
								'all_day'           => $all_day,
								'master_id'         => $master_id,
								'recurrence_anchor' => $anchor,
							)
						)
					);
				}
				++$count;
			}
		}

		// Delete rows whose anchor is no longer in the desired set.
		foreach ( $existing_by_anchor as $stale_row ) {
			EventDates::delete_by_id( $stale_row->id );
		}

		return $count;
	}

	/**
	 * Parse exdates string into an array of Y-m-d date strings
	 *
	 * @param string|null $exdates Comma-separated date string.
	 * @return array Array of Y-m-d date strings.
	 */
	public static function parse_exdates( $exdates ) {
		if ( empty( $exdates ) ) {
			return array();
		}

		return array_filter( array_map( 'trim', explode( ',', $exdates ) ) );
	}

	/**
	 * Clean stale exdates that no longer match any would-be occurrence date
	 *
	 * @param string $start_datetime Start datetime of the master event.
	 * @param string $end_datetime   End datetime of the master event.
	 * @param string $rrule          RRULE string.
	 * @param array  $exdates        Current exdates array.
	 * @return array Cleaned exdates array.
	 */
	public static function clean_stale_exdates( $start_datetime, $end_datetime, $rrule, $exdates ) {
		if ( empty( $exdates ) || empty( $rrule ) ) {
			return array();
		}

		// Generate all possible occurrences without exclusions to get valid dates.
		$all_occurrences = self::generate_occurrences( $start_datetime, $end_datetime, $rrule );

		$valid_dates = array();
		foreach ( $all_occurrences as $occ ) {
			$dt            = new \DateTime( $occ['start'] );
			$valid_dates[] = $dt->format( 'Y-m-d' );
		}

		// Keep only exdates that match a would-be occurrence (skip the master's own date).
		$master_date = ( new \DateTime( $start_datetime ) )->format( 'Y-m-d' );
		$cleaned     = array();
		foreach ( $exdates as $exdate ) {
			if ( $exdate !== $master_date && in_array( $exdate, $valid_dates, true ) ) {
				$cleaned[] = $exdate;
			}
		}

		return $cleaned;
	}

	/**
	 * Build an RRULE string from components
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
