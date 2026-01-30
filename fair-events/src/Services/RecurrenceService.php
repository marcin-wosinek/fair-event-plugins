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
	 * @return array Array of occurrences with 'start' and 'end' keys.
	 */
	public static function generate_occurrences( $start_datetime, $end_datetime, $rrule, $max = null ) {
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

			// Calculate end for this occurrence.
			$current_end = clone $current_start;
			$current_end->add( $duration );

			$occurrences[] = array(
				'start' => $current_start->format( 'Y-m-d\TH:i:s' ),
				'end'   => $current_end->format( 'Y-m-d\TH:i:s' ),
			);

			++$count;

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
	 * @param int         $event_id Event post ID.
	 * @param string|null $rrule    Optional RRULE to use. Pass null to read from database,
	 *                              pass empty string to explicitly clear recurrence.
	 * @return int Number of occurrences generated.
	 */
	public static function regenerate_event_occurrences( $event_id, $rrule = null ) {
		// Get the master/single occurrence.
		$master = EventDates::get_by_event_id( $event_id );

		if ( ! $master ) {
			return 0;
		}

		// Get the recurrence rule from database only if not provided (null).
		// Empty string means "explicitly no recurrence".
		if ( null === $rrule ) {
			$rrule = EventDates::get_rrule_by_event_id( $event_id );
		}

		// Delete existing generated occurrences.
		EventDates::delete_generated_occurrences( $event_id );

		// If no RRULE, ensure the existing record is marked as 'single'.
		if ( empty( $rrule ) ) {
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

		// Generate occurrences.
		$occurrences = self::generate_occurrences(
			$master->start_datetime,
			$master->end_datetime,
			$rrule
		);

		if ( empty( $occurrences ) ) {
			return 0;
		}

		// Update master occurrence (first one).
		$first     = array_shift( $occurrences );
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

		$count = 1;

		// Create generated occurrences.
		foreach ( $occurrences as $occurrence ) {
			$result = EventDates::save_occurrence(
				$event_id,
				$occurrence['start'],
				$occurrence['end'],
				$master->all_day,
				'generated',
				$master_id
			);

			if ( $result ) {
				++$count;
			}
		}

		return $count;
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
