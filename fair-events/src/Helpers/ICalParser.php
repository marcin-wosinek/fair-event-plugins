<?php
/**
 * iCal Parser Helper for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

use Sabre\VObject;

defined( 'WPINC' ) || die;

/**
 * ICalParser class for parsing iCal feeds
 */
class ICalParser {

	/**
	 * Fetch and parse iCal feed
	 *
	 * @param string $url iCal feed URL.
	 * @return array Array of event data, empty array on failure.
	 */
	public static function fetch_and_parse( $url ) {
		// Validate URL
		if ( empty( $url ) || ! filter_var( $url, FILTER_VALIDATE_URL ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'FairEvents: Invalid iCal URL provided: ' . $url );
			return array();
		}

		// Fetch iCal data with timeout
		$response = wp_remote_get(
			$url,
			array(
				'timeout' => 5,
				'headers' => array(
					'Accept' => 'text/calendar',
				),
			)
		);

		// Check for HTTP errors
		if ( is_wp_error( $response ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'FairEvents: iCal fetch failed: ' . $response->get_error_message() );
			return array();
		}

		$http_code = wp_remote_retrieve_response_code( $response );
		if ( 200 !== $http_code ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'FairEvents: iCal fetch returned HTTP ' . $http_code );
			return array();
		}

		$ical_data = wp_remote_retrieve_body( $response );

		// Parse iCal data
		try {
			$vcalendar = VObject\Reader::read( $ical_data );
		} catch ( \Exception $e ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'FairEvents: iCal parse error: ' . $e->getMessage() );
			return array();
		}

		// Extract events
		$events = array();
		foreach ( $vcalendar->VEVENT as $vevent ) {
			try {
				$event_data = self::parse_vevent( $vevent );
				if ( $event_data ) {
					$events[] = $event_data;
				}
			} catch ( \Exception $e ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( 'FairEvents: Error parsing iCal event: ' . $e->getMessage() );
				continue;
			}
		}

		return $events;
	}

	/**
	 * Parse a single VEVENT component
	 *
	 * @param \Sabre\VObject\Component\VEvent $vevent iCal event component.
	 * @return array|null Event data array or null if invalid.
	 */
	private static function parse_vevent( $vevent ) {
		// Required: DTSTART and SUMMARY
		if ( ! isset( $vevent->DTSTART ) || ! isset( $vevent->SUMMARY ) ) {
			return null;
		}

		// Get start date
		$dtstart        = $vevent->DTSTART->getDateTime();
		$start_datetime = $dtstart->format( 'Y-m-d H:i:s' );

		// Check if all-day event (DATE vs DATE-TIME)
		$all_day = ! $vevent->DTSTART->hasTime();

		// Get end date (use DTEND or DURATION, fallback to start date)
		if ( isset( $vevent->DTEND ) ) {
			$dtend        = $vevent->DTEND->getDateTime();
			$end_datetime = $dtend->format( 'Y-m-d H:i:s' );
		} elseif ( isset( $vevent->DURATION ) ) {
			$dtend = clone $dtstart;
			$dtend->add( VObject\DateTimeParser::parseDuration( $vevent->DURATION ) );
			$end_datetime = $dtend->format( 'Y-m-d H:i:s' );
		} else {
			$end_datetime = $start_datetime;
		}

		// For all-day events, ensure end date is adjusted correctly
		// iCal all-day events have exclusive end dates (e.g., 2025-01-02 means ends on 2025-01-01)
		if ( $all_day && $end_datetime !== $start_datetime ) {
			$dtend = new \DateTime( $end_datetime );
			$dtend->modify( '-1 day' );
			$end_datetime = $dtend->format( 'Y-m-d H:i:s' );
		}

		return array(
			'uid'         => isset( $vevent->UID ) ? (string) $vevent->UID : md5( $start_datetime . (string) $vevent->SUMMARY ),
			'summary'     => (string) $vevent->SUMMARY,
			'description' => isset( $vevent->DESCRIPTION ) ? (string) $vevent->DESCRIPTION : '',
			'start'       => $start_datetime,
			'end'         => $end_datetime,
			'all_day'     => $all_day,
		);
	}

	/**
	 * Filter events for a specific month
	 *
	 * @param array  $events      Array of parsed iCal events.
	 * @param string $month_start Start of month (Y-m-d H:i:s format).
	 * @param string $month_end   End of month (Y-m-d H:i:s format).
	 * @return array Filtered events within the month.
	 */
	public static function filter_events_for_month( $events, $month_start, $month_end ) {
		$filtered = array();
		foreach ( $events as $event ) {
			// Include event if it overlaps with the month
			// Event starts before month ends AND event ends after month starts
			if ( $event['start'] <= $month_end && $event['end'] >= $month_start ) {
				$filtered[] = $event;
			}
		}
		return $filtered;
	}
}
