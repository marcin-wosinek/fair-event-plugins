<?php
/**
 * Momoyoga event source for URL lookups
 *
 * Momoyoga event pages render their details with JavaScript: the fetched
 * HTML carries a title and Open Graph tags but no dates. The same details
 * are served anonymously by Momoyoga's public event endpoint, which this
 * helper reads to fill the fields the page itself does not expose.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Helpers;

defined( 'WPINC' ) || die;

/**
 * Recognizes Momoyoga event URLs and fills missing lookup fields from the
 * matching event's public data.
 */
class MomoyogaEventSource {

	/**
	 * Hosts that serve Momoyoga event pages. Matched exactly — a lookalike
	 * such as `momoyoga.com.example` or `evilmomoyoga.com` is not Momoyoga.
	 *
	 * @var string[]
	 */
	const PAGE_HOSTS = array( 'momoyoga.com', 'www.momoyoga.com' );

	/**
	 * Base of Momoyoga's public API, as used by its own event page.
	 *
	 * @var string
	 */
	const API_BASE = 'https://api.momoyoga.com/clients/';

	/**
	 * Maximum size of an event-data response.
	 *
	 * @var int
	 */
	const MAX_RESPONSE_BYTES = 512 * 1024;

	/**
	 * Identify a Momoyoga event page URL.
	 *
	 * @param string $url URL the user asked to look up.
	 * @return array{profile: string, event_id: string}|null The studio profile
	 *         name and event UUID, or null when the URL is not a Momoyoga
	 *         event page.
	 */
	public static function match_url( $url ) {
		if ( ! is_string( $url ) ) {
			return null;
		}

		$parts = wp_parse_url( $url );

		if ( ! is_array( $parts ) || empty( $parts['host'] ) || empty( $parts['path'] ) ) {
			return null;
		}

		$scheme = isset( $parts['scheme'] ) ? strtolower( $parts['scheme'] ) : '';
		if ( ! in_array( $scheme, array( 'http', 'https' ), true ) ) {
			return null;
		}

		if ( isset( $parts['user'] ) || isset( $parts['pass'] ) ) {
			return null;
		}

		if ( isset( $parts['port'] ) && ! in_array( (int) $parts['port'], array( 80, 443 ), true ) ) {
			return null;
		}

		if ( ! in_array( strtolower( $parts['host'] ), self::PAGE_HOSTS, true ) ) {
			return null;
		}

		if ( ! preg_match(
			'#^/([a-z0-9][a-z0-9-]{0,99})/event/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/?$#i',
			$parts['path'],
			$match
		) ) {
			return null;
		}

		return array(
			// Momoyoga's own router lowercases the profile name.
			'profile'  => strtolower( $match[1] ),
			'event_id' => strtolower( $match[2] ),
		);
	}

	/**
	 * Build the public event-data URL from validated identifiers.
	 *
	 * @param string $profile  Studio profile name from match_url().
	 * @param string $event_id Event UUID from match_url().
	 * @return string API URL.
	 */
	public static function api_url( $profile, $event_id ) {
		return self::API_BASE . rawurlencode( $profile ) . '/events/' . rawurlencode( $event_id );
	}

	/**
	 * Fill the fields a Momoyoga page's HTML did not provide.
	 *
	 * Fields already found on the page win; the event data only fills the
	 * gaps. A URL that is not a Momoyoga event page, or event data that
	 * cannot be fetched or does not describe the requested event, leaves
	 * the metadata unchanged.
	 *
	 * @param string $url      URL the user asked to look up.
	 * @param array  $metadata Result of PageMetadataParser::parse().
	 * @return array Metadata in the same shape, with `found` recomputed.
	 */
	public static function supplement( $url, $metadata ) {
		$match = self::match_url( $url );

		if ( ! $match || ! self::needs_supplement( $metadata ) ) {
			return $metadata;
		}

		$data = self::fetch_event_data( $match['profile'], $match['event_id'] );

		if ( null === $data ) {
			return $metadata;
		}

		$event = self::parse_event_data( $data, $match['event_id'] );

		if ( null === $event ) {
			return $metadata;
		}

		return self::merge( $metadata, $event );
	}

	/**
	 * Whether the page's own metadata is missing anything the event data
	 * could provide.
	 *
	 * @param array $metadata Parsed page metadata.
	 * @return bool
	 */
	private static function needs_supplement( $metadata ) {
		foreach ( array( 'title', 'start_date', 'end_date', 'location' ) as $field ) {
			if ( empty( $metadata[ $field ] ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Fetch the event's public data with the same protections as the page
	 * fetch: unsafe-target rejection, a short timeout, a capped response
	 * size, no redirects, and a 2xx JSON response.
	 *
	 * @param string $profile  Studio profile name.
	 * @param string $event_id Event UUID.
	 * @return array|null Decoded JSON object, or null on any failure.
	 */
	public static function fetch_event_data( $profile, $event_id ) {
		$response = wp_safe_remote_get(
			self::api_url( $profile, $event_id ),
			array(
				'timeout'             => 5,
				'redirection'         => 0,
				'limit_response_size' => self::MAX_RESPONSE_BYTES,
				'headers'             => array(
					// The endpoint answers 406 to plain application/json.
					'Accept' => 'application/ld+json',
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return null;
		}

		$status = (int) wp_remote_retrieve_response_code( $response );

		if ( $status < 200 || $status >= 300 ) {
			return null;
		}

		$content_type = wp_remote_retrieve_header( $response, 'content-type' );

		if ( ! is_string( $content_type ) || false === stripos( $content_type, 'json' ) ) {
			return null;
		}

		$body = wp_remote_retrieve_body( $response );

		if ( ! is_string( $body ) || '' === $body ) {
			return null;
		}

		$decoded = json_decode( $body, true );

		if ( JSON_ERROR_NONE !== json_last_error() || ! is_array( $decoded ) || array_values( $decoded ) === $decoded ) {
			return null;
		}

		return $decoded;
	}

	/**
	 * Extract lookup fields from decoded event data.
	 *
	 * @param array  $data     Decoded event data.
	 * @param string $event_id Event UUID the user asked for.
	 * @return array|null Fields in PageMetadataParser's shape (only the
	 *         ones present), or null when the data is not that event.
	 */
	public static function parse_event_data( $data, $event_id ) {
		if ( ! is_array( $data ) ) {
			return null;
		}

		if ( ! isset( $data['id'] ) || ! is_string( $data['id'] ) || 0 !== strcasecmp( $data['id'], $event_id ) ) {
			return null;
		}

		if ( isset( $data['@type'] ) && 'Event' !== $data['@type'] ) {
			return null;
		}

		$event = array();

		if ( ! empty( $data['title'] ) && is_string( $data['title'] ) ) {
			$title = sanitize_text_field( $data['title'] );
			if ( '' !== $title ) {
				$event['title'] = $title;
			}
		}

		if ( ! empty( $data['location'] ) && is_string( $data['location'] ) ) {
			$location = sanitize_text_field( $data['location'] );
			if ( '' !== $location ) {
				$event['location'] = $location;
			}
		}

		$start = isset( $data['fromTime'] ) && is_string( $data['fromTime'] ) ? self::parse_timestamp( $data['fromTime'] ) : null;

		if ( $start ) {
			$event['all_day']        = $start['all_day'];
			$event['start_datetime'] = $start['datetime'];
			$event['start_date']     = $start['date'];
			$event['start_time']     = $start['time'];

			$end = isset( $data['toTime'] ) && is_string( $data['toTime'] ) ? self::parse_timestamp( $data['toTime'] ) : null;

			// An end is only kept when it is the same kind of value as the
			// start and does not precede it; it is never invented.
			if ( $end && $end['all_day'] === $start['all_day'] && $end['datetime'] >= $start['datetime'] ) {
				$event['end_datetime'] = $end['datetime'];
				$event['end_date']     = $end['date'];
				$event['end_time']     = $end['time'];
			}
		}

		return $event;
	}

	/**
	 * Parse a Momoyoga timestamp into site-local values.
	 *
	 * A timestamp with an explicit offset (or `Z`) is converted to the site
	 * timezone. A date-only value is kept as written, as an all-day date.
	 * A date and time without any offset has no verified timezone, so only
	 * its date is kept and the time is left missing.
	 *
	 * @param string $value Timestamp from the event data.
	 * @return array{datetime: string, all_day: bool, date: string, time: string|null}|null
	 */
	public static function parse_timestamp( $value ) {
		$value = trim( $value );

		if ( preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m ) ) {
			if ( ! checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) ) {
				return null;
			}

			return array(
				'datetime' => $value . ' 00:00:00',
				'all_day'  => true,
				'date'     => $value,
				'time'     => null,
			);
		}

		if ( ! preg_match(
			'/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/',
			$value,
			$m
		) ) {
			return null;
		}

		if ( ! checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) ) {
			return null;
		}

		$date = $m[1] . '-' . $m[2] . '-' . $m[3];

		if ( empty( $m[4] ) ) {
			return array(
				'datetime' => $date . ' 00:00:00',
				'all_day'  => false,
				'date'     => $date,
				'time'     => null,
			);
		}

		try {
			$dt = new \DateTime( $value );
		} catch ( \Exception $e ) {
			return null;
		}

		$dt->setTimezone( wp_timezone() );
		$local = $dt->format( 'Y-m-d H:i:s' );

		return array(
			'datetime' => $local,
			'all_day'  => false,
			'date'     => substr( $local, 0, 10 ),
			'time'     => substr( $local, 11, 8 ),
		);
	}

	/**
	 * Fill missing page fields from the event data.
	 *
	 * The start and end are filled together: when the page gave no start,
	 * the event's whole timing is used; when the page gave a start but no
	 * end, the event's end is only used if the event's start agrees with
	 * the page's, so an end is never paired with a different start.
	 *
	 * @param array $metadata Parsed page metadata.
	 * @param array $event    Fields from parse_event_data().
	 * @return array Merged metadata with `found` recomputed.
	 */
	private static function merge( $metadata, $event ) {
		$filled = false;

		foreach ( array( 'title', 'location' ) as $field ) {
			if ( empty( $metadata[ $field ] ) && ! empty( $event[ $field ] ) ) {
				$metadata[ $field ] = $event[ $field ];
				$filled             = true;
			}
		}

		if ( empty( $metadata['start_date'] ) && ! empty( $event['start_date'] ) ) {
			foreach ( array( 'all_day', 'start_datetime', 'start_date', 'start_time', 'end_datetime', 'end_date', 'end_time' ) as $field ) {
				$metadata[ $field ] = array_key_exists( $field, $event ) ? $event[ $field ] : null;
			}
			$filled = true;
		} elseif (
			empty( $metadata['end_date'] )
			&& ! empty( $event['end_date'] )
			&& isset( $metadata['start_datetime'], $event['start_datetime'] )
			&& $metadata['start_datetime'] === $event['start_datetime']
			&& (bool) $metadata['all_day'] === $event['all_day']
		) {
			foreach ( array( 'end_datetime', 'end_date', 'end_time' ) as $field ) {
				$metadata[ $field ] = $event[ $field ];
			}
			$filled = true;
		}

		if ( $filled && empty( $metadata['source'] ) ) {
			$metadata['source'] = 'momoyoga';
		}

		$found = array();
		foreach ( array(
			'title'      => 'title',
			'start_date' => 'start',
			'end_date'   => 'end',
			'location'   => 'location',
		) as $field => $label ) {
			if ( ! empty( $metadata[ $field ] ) ) {
				$found[] = $label;
			}
		}
		$metadata['found'] = $found;

		return $metadata;
	}
}
