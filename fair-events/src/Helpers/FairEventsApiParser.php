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
		// Required fields: title and start
		if ( empty( $event['title'] ) || empty( $event['start'] ) ) {
			return null;
		}

		// Parse dates
		$start_datetime = strtotime( $event['start'] );
		if ( false === $start_datetime ) {
			return null;
		}

		$end_datetime = ! empty( $event['end'] ) ? strtotime( $event['end'] ) : $start_datetime;

		return array(
			'uid'         => $event['uid'] ?? md5( $event['start'] . $event['title'] ),
			'summary'     => $event['title'],
			'description' => $event['description'] ?? '',
			'url'         => $event['url'] ?? '',
			'start'       => gmdate( 'Y-m-d H:i:s', $start_datetime ),
			'end'         => gmdate( 'Y-m-d H:i:s', $end_datetime ),
			'all_day'     => $event['all_day'] ?? false,
		);
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
