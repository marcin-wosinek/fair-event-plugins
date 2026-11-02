<?php
/**
 * Meetup event-page fallback for Fair Event Plugins URL lookups
 *
 * Meetup event pages embed the event they show in the Next.js `__NEXT_DATA__`
 * JSON. When the page's schema.org JSON-LD is missing or incomplete, that
 * object can fill the gaps.
 *
 * A separate class rather than a new PageMetadataParser method: only one copy
 * of each shared class loads per request, so a new class is skew-safe while a
 * new method on an existing class is not (see PHP_PATTERNS.md § Shared
 * Package).
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Helpers;

defined( 'WPINC' ) || die;

/**
 * Fills missing PageMetadataParser fields from a Meetup event page's
 * embedded event data
 */
class MeetupEventData {

	/**
	 * Return the event ID of a Meetup event-page URL.
	 *
	 * Accepts `https://www.meetup.com/{group}/events/{id}/` with or without a
	 * locale prefix (`/es-ES/{group}/events/{id}/`), on meetup.com or any of
	 * its subdomains.
	 *
	 * @param string $url Page URL.
	 * @return string|null Numeric event ID, or null when the URL is not a Meetup event page.
	 */
	public static function event_id_from_url( $url ) {
		if ( ! is_string( $url ) ) {
			return null;
		}

		$parts = wp_parse_url( $url );

		if ( ! is_array( $parts ) || empty( $parts['host'] ) || empty( $parts['path'] ) ) {
			return null;
		}

		if ( ! in_array( $parts['scheme'] ?? '', array( 'http', 'https' ), true ) ) {
			return null;
		}

		$host = strtolower( $parts['host'] );

		if ( 'meetup.com' !== $host && '.meetup.com' !== substr( $host, -11 ) ) {
			return null;
		}

		if ( ! preg_match(
			'#^/(?:[a-z]{2}(?:-[a-z]{2})?/)?[a-z0-9_-]+/events/(\d+)/?$#i',
			$parts['path'],
			$match
		) ) {
			return null;
		}

		return $match[1];
	}

	/**
	 * Fill fields PageMetadataParser::parse() left empty from the Meetup
	 * event embedded in the page.
	 *
	 * Schema.org data stays authoritative: only missing title/start/end/
	 * location values are filled, plus a title that came from Open Graph or
	 * `<title>` (Meetup's carry the date and "| Meetup"). Non-Meetup URLs,
	 * pages without the embedded event, and an embedded event whose ID
	 * differs from the URL's leave the metadata unchanged.
	 *
	 * @param string $url      URL the page was fetched from.
	 * @param string $html     Raw HTML of the fetched page.
	 * @param array  $metadata Result of PageMetadataParser::parse().
	 * @return array Metadata with the same keys, missing values filled where possible.
	 */
	public static function fill_missing( $url, $html, $metadata ) {
		$event_id = self::event_id_from_url( $url );

		if ( null === $event_id || ! is_array( $metadata ) ) {
			return $metadata;
		}

		$event = self::find_event( $html, $event_id );

		if ( ! $event ) {
			return $metadata;
		}

		$filled    = false;
		$timezone  = isset( $event['timezone'] ) && is_string( $event['timezone'] ) ? $event['timezone'] : null;
		$is_schema = isset( $metadata['source'] ) && 'schema' === $metadata['source'];

		if ( ( empty( $metadata['title'] ) || ! $is_schema )
			&& ! empty( $event['title'] ) && is_string( $event['title'] ) ) {
			$title = sanitize_text_field( $event['title'] );
			if ( '' !== $title ) {
				$metadata['title'] = $title;
				$filled            = true;
			}
		}

		if ( empty( $metadata['start_datetime'] ) && ! empty( $event['dateTime'] ) && is_string( $event['dateTime'] ) ) {
			$start = self::to_local( $event['dateTime'], $timezone );
			if ( $start ) {
				$metadata['start_datetime'] = $start['datetime'];
				$metadata['all_day']        = $start['all_day'];
				$metadata['start_date']     = $start['date'];
				$metadata['start_time']     = $start['time'];
				$filled                     = true;
			}
		}

		if ( empty( $metadata['end_datetime'] ) && ! empty( $metadata['start_datetime'] )
			&& ! empty( $event['endTime'] ) && is_string( $event['endTime'] ) ) {
			$end = self::to_local( $event['endTime'], $timezone );
			if ( $end && $end['datetime'] >= $metadata['start_datetime'] ) {
				$metadata['end_datetime'] = $end['datetime'];
				$metadata['end_date']     = $end['date'];
				$metadata['end_time']     = ! empty( $metadata['all_day'] ) ? null : $end['time'];
				$filled                   = true;
			}
		}

		if ( empty( $metadata['location'] ) ) {
			$location = self::venue_name( $event );
			if ( $location ) {
				$metadata['location'] = $location;
				$filled               = true;
			}
		}

		if ( ! $filled ) {
			return $metadata;
		}

		if ( ! $is_schema ) {
			$metadata['source'] = 'meetup';
		}

		$found = array();
		foreach ( array(
			'title'          => 'title',
			'start_datetime' => 'start',
			'end_datetime'   => 'end',
			'location'       => 'location',
		) as $field => $label ) {
			if ( ! empty( $metadata[ $field ] ) ) {
				$found[] = $label;
			}
		}
		$metadata['found'] = $found;

		return $metadata;
	}

	/**
	 * Read the page's embedded event, `props.pageProps.event` in the
	 * `__NEXT_DATA__` JSON, when its ID matches the URL's event ID.
	 *
	 * The JSON is only decoded, never executed; recommended or related events
	 * elsewhere in the payload are ignored.
	 *
	 * @param string $html     Raw HTML.
	 * @param string $event_id Event ID from the URL.
	 * @return array|null Event object, or null.
	 */
	private static function find_event( $html, $event_id ) {
		if ( ! is_string( $html ) || false === strpos( $html, '__NEXT_DATA__' ) ) {
			return null;
		}

		if ( ! preg_match(
			'#<script[^>]*\bid=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>#is',
			$html,
			$match
		) ) {
			return null;
		}

		$data = json_decode( trim( $match[1] ), true );

		if ( JSON_ERROR_NONE !== json_last_error() || ! is_array( $data ) ) {
			return null;
		}

		$event = $data['props']['pageProps']['event'] ?? null;

		if ( ! is_array( $event ) || ! isset( $event['id'] ) ) {
			return null;
		}

		if ( ! is_scalar( $event['id'] ) || (string) $event['id'] !== $event_id ) {
			return null;
		}

		return $event;
	}

	/**
	 * Return the event's physical venue name, if any.
	 *
	 * @param array $event Embedded event.
	 * @return string|null Venue name, or null for online events and missing venues.
	 */
	private static function venue_name( $event ) {
		if ( isset( $event['eventType'] ) && 'ONLINE' === $event['eventType'] ) {
			return null;
		}

		if ( empty( $event['venue'] ) || ! is_array( $event['venue'] )
			|| empty( $event['venue']['name'] ) || ! is_string( $event['venue']['name'] ) ) {
			return null;
		}

		$name = sanitize_text_field( $event['venue']['name'] );

		return '' !== $name ? $name : null;
	}

	/**
	 * Convert a Meetup date/datetime string to site-local time.
	 *
	 * A datetime with an explicit offset is converted directly. One without
	 * an offset is read in the event's own timezone, and dropped when that
	 * timezone is missing or invalid rather than guessed. A date-only value
	 * is kept as written, as an all-day date.
	 *
	 * @param string      $value    ISO 8601 date or datetime.
	 * @param string|null $timezone Event's IANA timezone, e.g. 'Europe/Madrid'.
	 * @return array{datetime: string, all_day: bool, date: string, time: string|null}|null
	 */
	private static function to_local( $value, $timezone ) {
		$value = trim( $value );

		if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value ) ) {
			return array(
				'datetime' => $value . ' 00:00:00',
				'all_day'  => true,
				'date'     => $value,
				'time'     => null,
			);
		}

		if ( ! preg_match(
			'/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i',
			$value,
			$match
		) ) {
			return null;
		}

		try {
			if ( ! empty( $match[1] ) ) {
				$dt = new \DateTime( $value );
			} else {
				if ( empty( $timezone ) ) {
					return null;
				}
				$dt = new \DateTime( $value, new \DateTimeZone( $timezone ) );
			}
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
}
