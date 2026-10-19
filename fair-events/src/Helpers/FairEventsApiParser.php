<?php
/**
 * Fair Events API Parser Helper
 *
 * Parses JSON feeds from other Fair Events sites.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * FairEventsApiParser class for parsing Fair Events JSON feeds
 */
class FairEventsApiParser {

	/**
	 * Fetch and parse Fair Events API feed
	 *
	 * @param string      $url        Fair Events API URL.
	 * @param string|null $start_date Optional start date filter (Y-m-d format).
	 * @param string|null $end_date   Optional end date filter (Y-m-d format).
	 * @return array Array of event data, empty array on failure.
	 */
	public static function fetch_and_parse( $url, $start_date = null, $end_date = null ) {
		// Validate URL
		if ( empty( $url ) || ! filter_var( $url, FILTER_VALIDATE_URL ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'FairEvents: Invalid Fair Events API URL provided: ' . $url );
			return array();
		}

		// Build request URL with date parameters
		$request_params = array(
			'per_page' => 500,
		);

		if ( $start_date ) {
			$request_params['start_date'] = $start_date;
		}

		if ( $end_date ) {
			$request_params['end_date'] = $end_date;
		}

		$request_url = add_query_arg( $request_params, $url );

		// Fetch JSON data with timeout
		$response = wp_remote_get(
			$request_url,
			array(
				'timeout' => 5,
				'headers' => array(
					'Accept' => 'application/json',
				),
			)
		);

		// Check for HTTP errors
		if ( is_wp_error( $response ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'FairEvents: Fair Events API fetch failed: ' . $response->get_error_message() );
			return array();
		}

		$http_code = wp_remote_retrieve_response_code( $response );
		if ( 200 !== $http_code ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'FairEvents: Fair Events API fetch returned HTTP ' . $http_code );
			return array();
		}

		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		if ( json_last_error() !== JSON_ERROR_NONE ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'FairEvents: Fair Events API JSON parse error: ' . json_last_error_msg() );
			return array();
		}

		// Validate response structure
		if ( ! isset( $data['events'] ) || ! is_array( $data['events'] ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'FairEvents: Fair Events API response missing events array' );
			return array();
		}

		// Convert to internal format (similar to ICalParser output)
		$events = array();
		foreach ( $data['events'] as $event ) {
			$parsed = self::parse_event( $event );
			if ( $parsed ) {
				$events[] = $parsed;
			}
		}

		return $events;
	}

	/**
	 * Parse a single event from JSON response
	 *
	 * @param array $event Event data from JSON response.
	 * @return array|null Parsed event data or null if invalid.
	 */
	private static function parse_event( $event ) {
		// Required fields: a title, and a start datetime or (on newer sites,
		// which send `start` only with a start time or for all-day events) a
		// start date.
		if ( empty( $event['title'] ) || ( empty( $event['start'] ) && empty( $event['start_date'] ) ) ) {
			return null;
		}

		// Parse dates — convert ISO 8601 (any tz) to site-local time.
		$start_local = ! empty( $event['start'] ) ? DateHelper::iso8601_to_local( $event['start'] ) : null;
		if ( null === $start_local && ! empty( $event['start'] ) ) {
			return null;
		}

		$end_local = ! empty( $event['end'] ) ? DateHelper::iso8601_to_local( $event['end'] ) : $start_local;
		$all_day   = ! empty( $event['all_day'] );

		$timing = self::parse_timing( $event, $start_local, $end_local, $all_day );
		if ( ! $timing ) {
			if ( null === $start_local ) {
				return null;
			}
			$timing = EventTiming::from_datetimes( $start_local, $end_local, $all_day );
		}

		$range = EventTiming::range_keys( $timing );

		return array(
			'uid'         => $event['uid'] ?? md5( ( $event['start'] ?? $event['start_date'] ) . $event['title'] ),
			'summary'     => $event['title'],
			'description' => $event['description'] ?? '',
			'url'         => $event['url'] ?? '',
			'start'       => $range['start'],
			'end'         => $range['end'],
			'all_day'     => $all_day,
			'location'    => self::parse_location( $event['location'] ?? null ),
			'timing'      => $timing,
		);
	}

	/**
	 * Canonical timing from a feed event's dates and optional times, when
	 * the feed provides them (newer Fair Events sites do).
	 *
	 * A supplied time is taken from the timezone-aware `start`/`end`
	 * converted to site-local time. A missing time keeps the feed's date
	 * as written, so a date-only value never shifts through a timezone
	 * conversion and no time is invented.
	 *
	 * @param array       $event       Raw feed event.
	 * @param string|null $start_local Site-local start from the feed's `start`, if sent.
	 * @param string|null $end_local   Site-local end from the feed's `end`, if sent.
	 * @param bool        $all_day     All-day flag.
	 * @return array|null Canonical timing, or null when the feed has no dates or they are invalid.
	 */
	private static function parse_timing( array $event, $start_local, $end_local, $all_day ) {
		if ( ! array_key_exists( 'start_date', $event ) ) {
			return null;
		}

		$changes = EventTiming::normalize_changes(
			array_intersect_key( $event, array_flip( array( 'start_date', 'end_date', 'start_time', 'end_time' ) ) )
		);
		if ( ! is_array( $changes ) || empty( $changes['start_date'] ) ) {
			return null;
		}

		$timing = array(
			'start_date' => $changes['start_date'],
			'end_date'   => $changes['end_date'] ?? $changes['start_date'],
			'start_time' => null,
			'end_time'   => null,
			'all_day'    => $all_day,
		);

		if ( ! $all_day && null !== ( $changes['start_time'] ?? null ) && $start_local ) {
			$timing['start_date'] = substr( $start_local, 0, 10 );
			$timing['start_time'] = substr( $start_local, 11, 8 );
		}

		if ( ! $all_day && null !== ( $changes['end_time'] ?? null ) && $end_local ) {
			$timing['end_date'] = substr( $end_local, 0, 10 );
			$timing['end_time'] = substr( $end_local, 11, 8 );
		}

		if ( $timing['end_date'] < $timing['start_date'] ) {
			$timing['end_date'] = $timing['start_date'];
		}

		return null === EventTiming::validate( $timing ) ? $timing : null;
	}

	/**
	 * Sanitize an ingested feed location object into the neutral location
	 * shape (EventLocation::resolve()).
	 *
	 * @param mixed $location Raw `location` value from the feed JSON.
	 * @return array|null Neutral location shape, or null when absent/invalid.
	 */
	private static function parse_location( $location ) {
		if ( empty( $location ) || ! is_array( $location ) ) {
			return null;
		}

		$parsed = array();

		// New shape: explicit mode + joining_url. Older sites on a
		// pre-attendance-mode version still send the boolean `online`/`url`
		// pair, treated as an online-only location for interop.
		$mode = $location['mode'] ?? ( ! empty( $location['online'] ) ? 'online' : 'in_person' );

		if ( 'online' === $mode || 'hybrid' === $mode ) {
			$parsed['mode'] = $mode;

			$joining_url = $location['joining_url'] ?? ( $location['url'] ?? null );
			if ( ! empty( $joining_url ) ) {
				$parsed['joining_url'] = sanitize_url( $joining_url );
			}

			if ( 'online' === $mode ) {
				return $parsed;
			}
		} else {
			$parsed['mode'] = 'in_person';
		}

		if ( ! empty( $location['name'] ) ) {
			$parsed['name'] = sanitize_text_field( $location['name'] );
		}

		if ( ! empty( $location['address'] ) ) {
			$parsed['address'] = sanitize_text_field( $location['address'] );
		}

		if ( is_numeric( $location['latitude'] ?? null ) && is_numeric( $location['longitude'] ?? null ) ) {
			$parsed['latitude']  = (string) $location['latitude'];
			$parsed['longitude'] = (string) $location['longitude'];
		}

		// A parsed shape with only `mode` (no physical fields and, for
		// hybrid, no joining_url either) carries nothing worth keeping.
		$has_content = array_diff_key( $parsed, array( 'mode' => true ) );

		return ! empty( $has_content ) ? $parsed : null;
	}

	/**
	 * Filter events for a specific date range
	 *
	 * @param array  $events     Array of parsed events.
	 * @param string $range_start Start of range (Y-m-d H:i:s format).
	 * @param string $range_end   End of range (Y-m-d H:i:s format).
	 * @return array Filtered events within the range.
	 */
	public static function filter_events_for_month( $events, $range_start, $range_end ) {
		$filtered = array();
		foreach ( $events as $event ) {
			// Include event if it overlaps with the range
			// Event starts before range ends AND event ends after range starts
			if ( $event['start'] <= $range_end && $event['end'] >= $range_start ) {
				$filtered[] = $event;
			}
		}
		return $filtered;
	}
}
