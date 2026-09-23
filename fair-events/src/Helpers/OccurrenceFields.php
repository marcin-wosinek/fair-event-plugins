<?php
/**
 * Normalized per-event template fields for occurrence DTOs.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * Builds a stable set of `{{token}}` replacements from an
 * FairEvents\Services\EventFeedProvider occurrence DTO, so a per-event
 * pattern can display title, URL, dates, description, location, image, and
 * source type consistently across post-backed, standalone, iCal, and API
 * occurrences.
 *
 * Missing fields degrade safely: a missing title falls back to a translated
 * placeholder, a missing URL leaves `{{title_link_open}}`/`{{title_link_close}}`
 * empty (rendering unlinked text instead of an empty href), and a missing
 * description, location, or image resolves to an empty string so the
 * surrounding pattern markup renders without that value rather than breaking.
 *
 * A grouped recurring-series entry (one carrying `series` metadata, see
 * EventsListSeries::group()) makes `{{date_range}}` the combined schedule
 * summary ("Weekly on Mondays at 18:00; next occurrence: 28 September"), so
 * existing custom layouts pick it up unchanged. `{{recurrence_summary}}`
 * (schedule only, '' for non-series entries) and `{{next_occurrence}}` (the
 * selected occurrence's date) let a layout arrange the two parts itself.
 */
class OccurrenceFields {

	/**
	 * Build the token => replacement map for one occurrence.
	 *
	 * @param array $occurrence Occurrence DTO, as returned by EventFeedProvider::get_occurrences().
	 * @return array<string, string> Token => already-escaped HTML replacement.
	 */
	public static function build_tokens( array $occurrence ) {
		$title = ! empty( $occurrence['title'] )
			? $occurrence['title']
			: __( '(untitled event)', 'fair-events' );

		$url = ! empty( $occurrence['url'] ) ? $occurrence['url'] : '';

		return array(
			'{{title}}'              => esc_html( $title ),
			'{{title_link_open}}'    => '' !== $url ? '<a href="' . esc_url( $url ) . '">' : '',
			'{{title_link_close}}'   => '' !== $url ? '</a>' : '',
			'{{url}}'                => esc_url( $url ),
			'{{start}}'              => self::format_datetime( $occurrence['start'] ?? '' ),
			'{{end}}'                => self::format_datetime( $occurrence['end'] ?? '' ),
			'{{date_range}}'         => esc_html( EventsListSeries::date_text( $occurrence ) ),
			'{{recurrence_summary}}' => ! empty( $occurrence['series'] ) ? esc_html( RecurrenceSummary::format_schedule( $occurrence['series'] ) ) : '',
			'{{next_occurrence}}'    => esc_html( self::format_next_occurrence( $occurrence ) ),
			'{{description}}'        => ! empty( $occurrence['description'] ) ? esc_html( $occurrence['description'] ) : '',
			'{{location}}'           => esc_html( self::format_location( $occurrence['location'] ?? null ) ),
			'{{image}}'              => self::format_image( $occurrence ),
			'{{source_type}}'        => esc_html( self::format_source_label( $occurrence['source'] ?? '' ) ),
		);
	}

	/**
	 * Replace every `{{token}}` in pattern content with the occurrence's values.
	 *
	 * @param array  $occurrence      Occurrence DTO.
	 * @param string $pattern_content Pattern block markup containing `{{token}}` placeholders.
	 * @return string Pattern content with tokens replaced.
	 */
	public static function render( array $occurrence, $pattern_content ) {
		return strtr( (string) $pattern_content, self::build_tokens( $occurrence ) );
	}

	/**
	 * Format a naive site-local datetime for display, or '' if empty/invalid.
	 *
	 * @param string $datetime Naive 'Y-m-d H:i:s' site-local datetime.
	 * @return string Localized date/time, or ''.
	 */
	private static function format_datetime( $datetime ) {
		if ( empty( $datetime ) ) {
			return '';
		}

		$format = trim( get_option( 'date_format', 'F j, Y' ) . ' ' . get_option( 'time_format', 'g:i a' ) );

		return esc_html( DateHelper::format_local_datetime( $datetime, $format ) );
	}

	/**
	 * The selected occurrence's date: date-only when a series summary already
	 * states the regular time, otherwise its full date range.
	 *
	 * @param array $occurrence Occurrence DTO (optionally with `series`).
	 * @return string Plain text, or ''.
	 */
	private static function format_next_occurrence( array $occurrence ) {
		if ( ! empty( $occurrence['series'] ) ) {
			return RecurrenceSummary::format_next( $occurrence['series'], $occurrence );
		}

		return DateRangeFormatter::format(
			$occurrence['start'] ?? '',
			$occurrence['end'] ?? '',
			! empty( $occurrence['all_day'] )
		);
	}

	/**
	 * Format a location into short display text.
	 *
	 * Accepts either the neutral shape from EventLocation::resolve() (an
	 * array with mode/name/address/joining_url, used for post-backed and
	 * standalone occurrences), or the raw string an iCal/API occurrence
	 * supplies directly.
	 *
	 * @param array|string|null $location Location value from the occurrence DTO.
	 * @return string Display text, or '' when nothing resolves.
	 */
	private static function format_location( $location ) {
		if ( is_string( $location ) ) {
			return $location;
		}

		if ( ! is_array( $location ) ) {
			return '';
		}

		$parts = array();
		if ( ! empty( $location['name'] ) ) {
			$parts[] = $location['name'];
		}
		if ( ! empty( $location['address'] ) ) {
			$parts[] = $location['address'];
		}

		if ( ! empty( $parts ) ) {
			return implode( ', ', $parts );
		}

		if ( ! empty( $location['joining_url'] ) ) {
			return __( 'Online', 'fair-events' );
		}

		return '';
	}

	/**
	 * Build an `<img>` tag for the occurrence's featured image, or '' when
	 * none is available.
	 *
	 * Only post-backed occurrences currently carry an image (their linked
	 * post's featured image) — standalone, iCal, and API occurrences have no
	 * image concept yet, so this always resolves to '' for them.
	 *
	 * @param array $occurrence Occurrence DTO.
	 * @return string `<img>` HTML, or ''.
	 */
	private static function format_image( array $occurrence ) {
		if ( 'post' !== ( $occurrence['source'] ?? '' ) || empty( $occurrence['event_id'] ) ) {
			return '';
		}

		if ( ! function_exists( 'has_post_thumbnail' ) || ! has_post_thumbnail( $occurrence['event_id'] ) ) {
			return '';
		}

		$image = get_the_post_thumbnail( $occurrence['event_id'], 'medium' );

		return $image ? $image : '';
	}

	/**
	 * Human-readable label for an occurrence source, for pattern authors who
	 * want to show provenance (e.g. badging external events).
	 *
	 * @param string $source One of 'post', 'standalone', 'ical', 'api'.
	 * @return string Translated label.
	 */
	private static function format_source_label( $source ) {
		switch ( $source ) {
			case 'post':
				return __( 'Event', 'fair-events' );
			case 'standalone':
				return __( 'Standalone event', 'fair-events' );
			case 'ical':
				return __( 'Calendar feed', 'fair-events' );
			case 'api':
				return __( 'External source', 'fair-events' );
			default:
				return '';
		}
	}
}
