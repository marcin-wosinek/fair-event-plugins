<?php
/**
 * Event Translation Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * Resolves post-linked occurrence titles/URLs to their Polylang translation
 * matching the current front-end language.
 *
 * Used by the Events Calendar and Events Week blocks only — not
 * EventFeedProvider itself, so the iCal feed, Events List block, and the
 * REST controllers that share EventFeedProvider are unaffected. Every
 * Polylang call is guarded with `function_exists()` so sites without
 * Polylang (or with it deactivated) see zero behaviour change.
 */
class EventTranslation {

	/**
	 * Per-request cache of resolved translated post IDs, keyed by
	 * "{event_id}:{language}". Avoids re-resolving the same event across
	 * every occurrence of a recurring series.
	 *
	 * @var array<string, int|null>
	 */
	private static $resolved_ids = array();

	/**
	 * Translate every post-linked occurrence in place to the current
	 * Polylang language, falling back to the original title/url when no
	 * published translation exists.
	 *
	 * @param array $occurrences Occurrence DTOs from EventFeedProvider::get_occurrences().
	 * @return array Occurrence DTOs, translated where applicable.
	 */
	public static function translate_occurrences( array $occurrences ) {
		if ( ! function_exists( 'pll_current_language' ) || ! function_exists( 'pll_get_post' ) ) {
			return $occurrences;
		}

		$language = pll_current_language();
		if ( ! $language ) {
			return $occurrences;
		}

		return array_map(
			static function ( $occurrence ) use ( $language ) {
				return self::translate_occurrence( $occurrence, $language );
			},
			$occurrences
		);
	}

	/**
	 * Translate a single occurrence.
	 *
	 * @param array  $occurrence Occurrence DTO.
	 * @param string $language   Current Polylang language slug.
	 * @return array Occurrence DTO, translated if applicable.
	 */
	private static function translate_occurrence( array $occurrence, $language ) {
		if ( 'post' !== $occurrence['source'] || empty( $occurrence['event_id'] ) ) {
			return $occurrence;
		}

		$event_id      = (int) $occurrence['event_id'];
		$translated_id = self::resolve_translated_id( $event_id, $language );

		if ( ! $translated_id || $translated_id === $event_id ) {
			return $occurrence;
		}

		if ( 'publish' !== get_post_status( $translated_id ) ) {
			return $occurrence;
		}

		$url = get_permalink( $translated_id );
		if ( $url && 'generated' === $occurrence['occurrence_type'] ) {
			$url = add_query_arg( 'event_date', gmdate( 'Y-m-d', strtotime( $occurrence['start'] ) ), $url );
		}

		$occurrence['title'] = get_the_title( $translated_id );
		$occurrence['url']   = $url ? $url : $occurrence['url'];

		return $occurrence;
	}

	/**
	 * Resolve (and cache) the translated post id for an event/language pair.
	 *
	 * @param int    $event_id Original linked post ID.
	 * @param string $language Polylang language slug.
	 * @return int|null Translated post ID, or null if none.
	 */
	private static function resolve_translated_id( $event_id, $language ) {
		$cache_key = $event_id . ':' . $language;

		if ( array_key_exists( $cache_key, self::$resolved_ids ) ) {
			return self::$resolved_ids[ $cache_key ];
		}

		$translated_id = pll_get_post( $event_id, $language );

		self::$resolved_ids[ $cache_key ] = $translated_id ? (int) $translated_id : null;

		return self::$resolved_ids[ $cache_key ];
	}
}
