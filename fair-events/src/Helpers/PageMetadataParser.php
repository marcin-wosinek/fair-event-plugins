<?php
/**
 * Page Metadata Parser Helper for Fair Events
 *
 * Extracts event-ish metadata from an arbitrary HTML page: schema.org Event
 * (JSON-LD) first, falling back field-by-field to Open Graph, then <title>.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * PageMetadataParser class for extracting event metadata from HTML
 */
class PageMetadataParser {

	/**
	 * Parse HTML and extract whatever event metadata it can find.
	 *
	 * @param string $html Raw HTML of the fetched page.
	 * @return array {
	 *     @type string|null $title          Event or page title.
	 *     @type string|null $start_datetime Site-local 'Y-m-d H:i:s'.
	 *     @type string|null $end_datetime   Site-local 'Y-m-d H:i:s'.
	 *     @type bool        $all_day        Whether the source gave date-only values.
	 *     @type string|null $location       Free-text location/venue name.
	 *     @type string|null $source         'schema', 'opengraph', or 'title'.
	 *     @type string[]    $found          Which of title/start/end/location were found.
	 * }
	 */
	public static function parse( $html ) {
		$result = array(
			'title'          => null,
			'start_datetime' => null,
			'end_datetime'   => null,
			'all_day'        => false,
			'location'       => null,
			'source'         => null,
		);

		$event = self::find_schema_event( $html );

		if ( $event ) {
			$result['source'] = 'schema';

			if ( ! empty( $event['name'] ) && is_string( $event['name'] ) ) {
				$result['title'] = sanitize_text_field( $event['name'] );
			}

			if ( ! empty( $event['startDate'] ) && is_string( $event['startDate'] ) ) {
				$start = self::parse_schema_date( $event['startDate'] );
				if ( $start ) {
					$result['start_datetime'] = $start['datetime'];
					$result['all_day']        = $start['all_day'];
				}
			}

			if ( ! empty( $event['endDate'] ) && is_string( $event['endDate'] ) ) {
				$end = self::parse_schema_date( $event['endDate'] );
				if ( $end ) {
					$result['end_datetime'] = $end['datetime'];
				}
			}

			$location = self::extract_schema_location( $event );
			if ( $location ) {
				$result['location'] = $location;
			}
		}

		$og = self::find_open_graph( $html );

		if ( empty( $result['title'] ) && ! empty( $og['title'] ) ) {
			$result['title']  = sanitize_text_field( $og['title'] );
			$result['source'] = $result['source'] ?? 'opengraph';
		}

		if ( empty( $result['title'] ) ) {
			$title = self::find_title_tag( $html );
			if ( $title ) {
				$result['title']  = sanitize_text_field( $title );
				$result['source'] = $result['source'] ?? 'title';
			}
		}

		$found = array();
		foreach ( array( 'title', 'start_datetime', 'end_datetime', 'location' ) as $field ) {
			if ( ! empty( $result[ $field ] ) ) {
				$found[] = 'start_datetime' === $field ? 'start' : ( 'end_datetime' === $field ? 'end' : $field );
			}
		}
		$result['found'] = $found;

		return $result;
	}

	/**
	 * Find the first schema.org Event (or subtype) node in JSON-LD blocks.
	 *
	 * @param string $html Raw HTML.
	 * @return array|null Decoded Event node, or null if none found.
	 */
	private static function find_schema_event( $html ) {
		if ( empty( $html ) || false === stripos( $html, 'application/ld+json' ) ) {
			return null;
		}

		if ( ! preg_match_all(
			'#<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>#is',
			$html,
			$matches
		) ) {
			return null;
		}

		foreach ( $matches[1] as $block ) {
			$decoded = json_decode( trim( $block ), true );

			if ( JSON_ERROR_NONE !== json_last_error() || ! is_array( $decoded ) ) {
				continue;
			}

			$event = self::find_event_node( $decoded );
			if ( $event ) {
				return $event;
			}
		}

		return null;
	}

	/**
	 * Recursively walk a decoded JSON-LD structure for an Event node.
	 *
	 * @param mixed $node Decoded JSON-LD value (object as array, or list).
	 * @return array|null Event node, or null.
	 */
	private static function find_event_node( $node ) {
		if ( ! is_array( $node ) ) {
			return null;
		}

		if ( isset( $node['@type'] ) ) {
			$type = is_array( $node['@type'] ) ? $node['@type'] : array( $node['@type'] );
			foreach ( $type as $type_name ) {
				if ( is_string( $type_name ) && false !== stripos( $type_name, 'event' ) ) {
					return $node;
				}
			}
		}

		if ( isset( $node['@graph'] ) && is_array( $node['@graph'] ) ) {
			$found = self::find_event_node( $node['@graph'] );
			if ( $found ) {
				return $found;
			}
		}

		// A plain (non-associative) list of nodes.
		if ( array_values( $node ) === $node ) {
			foreach ( $node as $item ) {
				$found = self::find_event_node( $item );
				if ( $found ) {
					return $found;
				}
			}
		}

		return null;
	}

	/**
	 * Extract a free-text location name from a schema.org Event's `location`.
	 *
	 * @param array $event Decoded Event node.
	 * @return string|null Location name, or null.
	 */
	private static function extract_schema_location( $event ) {
		if ( empty( $event['location'] ) ) {
			return null;
		}

		$location = $event['location'];

		if ( is_string( $location ) ) {
			return sanitize_text_field( $location );
		}

		if ( is_array( $location ) ) {
			// A list of locations — use the first one.
			if ( array_values( $location ) === $location ) {
				$location = $location[0] ?? null;
			}

			if ( is_array( $location ) && ! empty( $location['name'] ) && is_string( $location['name'] ) ) {
				return sanitize_text_field( $location['name'] );
			}
		}

		return null;
	}

	/**
	 * Parse a schema.org date/datetime string into site-local time.
	 *
	 * @param string $value ISO 8601 date or datetime string.
	 * @return array{datetime: string, all_day: bool}|null
	 */
	private static function parse_schema_date( $value ) {
		$value = trim( $value );

		// Date-only value (no time component) — treat as all-day.
		if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value ) ) {
			return array(
				'datetime' => $value . ' 00:00:00',
				'all_day'  => true,
			);
		}

		$local = DateHelper::iso8601_to_local( $value );

		if ( ! $local ) {
			return null;
		}

		return array(
			'datetime' => $local,
			'all_day'  => false,
		);
	}

	/**
	 * Read Open Graph meta tags from the page.
	 *
	 * @param string $html Raw HTML.
	 * @return array Associative array of found `og:*` properties (title only, currently).
	 */
	private static function find_open_graph( $html ) {
		$og = array();

		if ( preg_match(
			'#<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']*)["\'][^>]*>#i',
			$html,
			$match
		) ) {
			$og['title'] = html_entity_decode( $match[1], ENT_QUOTES );
		}

		return $og;
	}

	/**
	 * Read the page's `<title>` tag.
	 *
	 * @param string $html Raw HTML.
	 * @return string|null Title text, or null.
	 */
	private static function find_title_tag( $html ) {
		if ( preg_match( '#<title[^>]*>(.*?)</title>#is', $html, $match ) ) {
			$title = html_entity_decode( trim( $match[1] ), ENT_QUOTES );
			return '' !== $title ? $title : null;
		}

		return null;
	}
}
