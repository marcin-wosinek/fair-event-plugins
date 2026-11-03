<?php
/**
 * Primary schema.org Event selection for Fair Event Plugins URL lookups
 *
 * PageMetadataParser::parse() takes the first schema.org Event it finds. On
 * pages that wrap their own event in `WebPage.mainEntity` (Oona, for one) or
 * also list related events, that can be the wrong event or none at all. This
 * class picks the page's primary event using the page URL, refuses to merge
 * several sessions into one continuous interval, and converts its timestamps
 * only when their timezone is explicit.
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
 * Replaces PageMetadataParser's schema-derived fields with those of the
 * page's primary event
 */
class PrimaryEventData {

	/**
	 * Re-derive the schema.org fields of PageMetadataParser::parse() output
	 * from the page's primary Event.
	 *
	 * The primary event is, in order: an Event whose `url` or `@id` is the
	 * page URL; an Event that is a WebPage's `mainEntity`; the first
	 * top-level Event. When several distinct sessions are equally primary, or
	 * the event itself lists sub-events or a schedule, the title and location
	 * are kept but the timing is left empty and `timing_ambiguous` is true —
	 * sessions are never combined into one interval. Pages without any
	 * schema.org Event are returned unchanged.
	 *
	 * @param string $url      URL the page was fetched from.
	 * @param string $html     Raw HTML of the fetched page.
	 * @param array  $metadata PageMetadataParser::parse() output.
	 * @return array Metadata in the same shape, plus a `timing_ambiguous` flag.
	 */
	public static function apply( $url, $html, $metadata ) {
		$metadata['timing_ambiguous'] = false;

		$candidates = self::find_candidates( $html );

		if ( empty( $candidates ) ) {
			return $metadata;
		}

		$selection = self::select_primary( $candidates, $url );
		$event     = $selection['event'];
		$ambiguous = $selection['ambiguous'] || self::has_several_sessions( $event );

		foreach ( array( 'start_datetime', 'end_datetime', 'start_date', 'start_time', 'end_date', 'end_time', 'location' ) as $field ) {
			$metadata[ $field ] = null;
		}
		$metadata['all_day']          = false;
		$metadata['source']           = 'schema';
		$metadata['timing_ambiguous'] = $ambiguous;

		if ( ! empty( $event['name'] ) && is_string( $event['name'] ) ) {
			$metadata['title'] = sanitize_text_field( $event['name'] );
		} else {
			// The parser's title may belong to another event: fall back to
			// the page's own Open Graph or <title> instead.
			$fallback          = PageMetadataParser::parse( self::strip_json_ld( $html ) );
			$metadata['title'] = $fallback['title'];
		}

		if ( ! $ambiguous ) {
			$metadata = array_merge( $metadata, self::extract_timing( $event ) );
		}

		$metadata['location'] = self::extract_location( $event );

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
	 * Collect the page's top-level Events and WebPage main entities.
	 *
	 * Only top-level nodes, `@graph` members, and `mainEntity` values are
	 * considered — events nested elsewhere (offers, recommendations,
	 * `subjectOf`) are never selected.
	 *
	 * @param string $html Raw HTML.
	 * @return array[] List of `array( 'event' => array, 'main_entity' => bool )`.
	 */
	private static function find_candidates( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, 'application/ld+json' ) ) {
			return array();
		}

		if ( ! preg_match_all(
			'#<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>#is',
			$html,
			$matches
		) ) {
			return array();
		}

		$nodes = array();
		foreach ( $matches[1] as $block ) {
			$decoded = json_decode( trim( $block ), true );

			if ( JSON_ERROR_NONE !== json_last_error() || ! is_array( $decoded ) ) {
				continue;
			}

			self::flatten_nodes( $decoded, $nodes );
		}

		$by_id = array();
		foreach ( $nodes as $node ) {
			if ( isset( $node['@id'] ) && is_string( $node['@id'] ) ) {
				$by_id[ $node['@id'] ] = $node;
			}
		}

		$candidates = array();
		foreach ( $nodes as $node ) {
			if ( self::is_event( $node ) ) {
				$candidates[] = array(
					'event'       => $node,
					'main_entity' => false,
				);
			}

			if ( empty( $node['mainEntity'] ) || ! is_array( $node['mainEntity'] ) ) {
				continue;
			}

			$entities = self::is_list( $node['mainEntity'] ) ? $node['mainEntity'] : array( $node['mainEntity'] );
			foreach ( $entities as $entity ) {
				// A bare reference to a node declared elsewhere on the page.
				if ( is_array( $entity ) && ! isset( $entity['@type'] ) && isset( $entity['@id'] ) && is_string( $entity['@id'] ) && isset( $by_id[ $entity['@id'] ] ) ) {
					$entity = $by_id[ $entity['@id'] ];
				}

				if ( self::is_event( $entity ) ) {
					$candidates[] = array(
						'event'       => $entity,
						'main_entity' => true,
					);
				}
			}
		}

		return $candidates;
	}

	/**
	 * Flatten a decoded JSON-LD block into its top-level nodes.
	 *
	 * @param mixed $value Decoded JSON-LD value.
	 * @param array $nodes Collected nodes (by reference).
	 * @return void
	 */
	private static function flatten_nodes( $value, &$nodes ) {
		if ( ! is_array( $value ) ) {
			return;
		}

		if ( self::is_list( $value ) ) {
			foreach ( $value as $item ) {
				self::flatten_nodes( $item, $nodes );
			}
			return;
		}

		$nodes[] = $value;

		if ( isset( $value['@graph'] ) && is_array( $value['@graph'] ) ) {
			self::flatten_nodes( $value['@graph'], $nodes );
		}
	}

	/**
	 * Pick the primary event among the candidates.
	 *
	 * @param array[] $candidates Candidates from find_candidates().
	 * @param string  $url        Page URL.
	 * @return array{event: array, ambiguous: bool}
	 */
	private static function select_primary( $candidates, $url ) {
		$page_key = self::url_key( $url );

		$set = array();
		if ( $page_key ) {
			foreach ( $candidates as $candidate ) {
				$event = $candidate['event'];
				foreach ( array( 'url', '@id' ) as $key ) {
					if ( isset( $event[ $key ] ) && is_string( $event[ $key ] ) && self::url_key( $event[ $key ] ) === $page_key ) {
						$set[] = $event;
						break;
					}
				}
			}
		}

		if ( empty( $set ) ) {
			foreach ( $candidates as $candidate ) {
				if ( $candidate['main_entity'] ) {
					$set[] = $candidate['event'];
				}
			}
		}

		if ( empty( $set ) ) {
			// No page-level signal: keep PageMetadataParser's first-event rule.
			return array(
				'event'     => $candidates[0]['event'],
				'ambiguous' => false,
			);
		}

		// The same event is often declared twice (e.g. as a graph node and as
		// the main entity); only distinct start times are separate sessions.
		$starts = array();
		foreach ( $set as $event ) {
			$starts[ self::string_field( $event, 'startDate' ) ] = true;
		}

		return array(
			'event'     => $set[0],
			'ambiguous' => count( $starts ) > 1,
		);
	}

	/**
	 * Whether the event itself describes several sessions.
	 *
	 * @param array $event Event node.
	 * @return bool
	 */
	private static function has_several_sessions( $event ) {
		$types = isset( $event['@type'] ) ? (array) $event['@type'] : array();
		foreach ( $types as $type ) {
			if ( is_string( $type ) && false !== stripos( $type, 'EventSeries' ) ) {
				return true;
			}
		}

		if ( ! empty( $event['eventSchedule'] ) ) {
			return true;
		}

		return isset( $event['subEvent'] ) && is_array( $event['subEvent'] )
			&& self::is_list( $event['subEvent'] ) && count( $event['subEvent'] ) > 1;
	}

	/**
	 * Extract the site-local timing fields of a single-occurrence event.
	 *
	 * @param array $event Event node.
	 * @return array Timing fields in PageMetadataParser::parse() shape; empty when the start is missing or invalid.
	 */
	private static function extract_timing( $event ) {
		$start = self::parse_date( self::string_field( $event, 'startDate' ) );

		if ( ! $start ) {
			return array();
		}

		$all_day = null === $start['time'];
		$timing  = array(
			'all_day'        => $all_day,
			'start_date'     => $start['date'],
			'start_time'     => $start['time'],
			'start_datetime' => $start['date'] . ' ' . ( $all_day ? '00:00:00' : $start['time'] ),
		);

		$end = self::parse_date( self::string_field( $event, 'endDate' ) );

		if ( ! $end ) {
			return $timing;
		}

		$end_time = $all_day ? null : $end['time'];

		// An interval that ends before it starts is unusable: keep the start
		// and leave the end for manual completion.
		if ( $end['date'] < $start['date'] ) {
			return $timing;
		}
		if ( $end['date'] === $start['date'] && null !== $end_time && null !== $start['time'] && $end_time < $start['time'] ) {
			return $timing;
		}

		$timing['end_date']     = $end['date'];
		$timing['end_time']     = $end_time;
		$timing['end_datetime'] = $end['date'] . ' ' . ( null === $end_time ? '00:00:00' : $end_time );

		return $timing;
	}

	/**
	 * Parse a schema.org date or datetime into site-local parts.
	 *
	 * Date-only values are kept as written. Datetimes need an explicit
	 * offset (`Z` or `±hh:mm`); without one, the source timezone is unknown
	 * and the value is rejected rather than guessed.
	 *
	 * @param string|null $value ISO 8601 value.
	 * @return array{date: string, time: string|null}|null
	 */
	private static function parse_date( $value ) {
		if ( null === $value ) {
			return null;
		}

		$value = trim( $value );

		if ( preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m ) ) {
			return checkdate( (int) $m[2], (int) $m[3], (int) $m[1] )
				? array(
					'date' => $value,
					'time' => null,
				)
				: null;
		}

		if ( ! preg_match(
			'/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i',
			$value,
			$m
		) ) {
			return null;
		}

		$seconds = isset( $m[6] ) && '' !== $m[6] ? (int) $m[6] : 0;

		if ( ! checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) || (int) $m[4] > 23 || (int) $m[5] > 59 || $seconds > 59 ) {
			return null;
		}

		$offset = strtoupper( $m[7] );
		if ( 'Z' !== $offset ) {
			$digits = str_replace( ':', '', substr( $offset, 1 ) );
			if ( (int) substr( $digits, 0, 2 ) > 14 || (int) substr( $digits, 2, 2 ) > 59 ) {
				return null;
			}
		}

		try {
			$dt = new \DateTime( sprintf( '%s-%s-%sT%s:%s:%02d%s', $m[1], $m[2], $m[3], $m[4], $m[5], $seconds, 'Z' === $offset ? '+00:00' : $offset ) );
		} catch ( \Exception $e ) {
			return null;
		}

		$dt->setTimezone( wp_timezone() );

		return array(
			'date' => $dt->format( 'Y-m-d' ),
			'time' => $dt->format( 'H:i:s' ),
		);
	}

	/**
	 * Extract a free-text location name from the event's `location`.
	 *
	 * @param array $event Event node.
	 * @return string|null Location name, or null.
	 */
	private static function extract_location( $event ) {
		if ( empty( $event['location'] ) ) {
			return null;
		}

		$location = $event['location'];

		if ( is_string( $location ) ) {
			$location = sanitize_text_field( $location );
			return '' !== $location ? $location : null;
		}

		if ( is_array( $location ) && self::is_list( $location ) ) {
			$location = $location[0] ?? null;
		}

		if ( is_array( $location ) && ! empty( $location['name'] ) && is_string( $location['name'] ) ) {
			$name = sanitize_text_field( $location['name'] );
			return '' !== $name ? $name : null;
		}

		return null;
	}

	/**
	 * Whether a node is a schema.org Event (or subtype).
	 *
	 * @param mixed $node Decoded node.
	 * @return bool
	 */
	private static function is_event( $node ) {
		if ( ! is_array( $node ) || ! isset( $node['@type'] ) ) {
			return false;
		}

		foreach ( (array) $node['@type'] as $type ) {
			if ( is_string( $type ) && false !== stripos( $type, 'event' ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Comparable form of a URL: host without `www.` plus path without a
	 * trailing slash. Scheme, query, and fragment are ignored.
	 *
	 * @param mixed $url URL.
	 * @return string|null Key, or null for an unparsable URL.
	 */
	private static function url_key( $url ) {
		if ( ! is_string( $url ) ) {
			return null;
		}

		$parts = wp_parse_url( trim( $url ) );

		if ( ! is_array( $parts ) || empty( $parts['host'] ) ) {
			return null;
		}

		$host = strtolower( $parts['host'] );
		if ( 0 === strpos( $host, 'www.' ) ) {
			$host = substr( $host, 4 );
		}

		return $host . rtrim( $parts['path'] ?? '', '/' );
	}

	/**
	 * Read a non-empty string field.
	 *
	 * @param array  $node Node.
	 * @param string $key  Field name.
	 * @return string|null
	 */
	private static function string_field( $node, $key ) {
		return isset( $node[ $key ] ) && is_string( $node[ $key ] ) && '' !== trim( $node[ $key ] ) ? $node[ $key ] : null;
	}

	/**
	 * Whether an array is a plain (non-associative) list.
	 *
	 * @param array $value Array.
	 * @return bool
	 */
	private static function is_list( $value ) {
		return array_values( $value ) === $value;
	}

	/**
	 * Remove JSON-LD blocks, leaving Open Graph and <title> for fallbacks.
	 *
	 * @param string $html Raw HTML.
	 * @return string
	 */
	private static function strip_json_ld( $html ) {
		return (string) preg_replace( '#<script[^>]*type=["\']application/ld\+json["\'][^>]*>.*?</script>#is', '', $html );
	}
}
