<?php
/**
 * Event Translation Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Helpers\OccurrenceDateParam;

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
	 * Per-request cache of a translated post's title/permalink, keyed by
	 * translated post id. Separate from $resolved_ids because a recurring
	 * series' occurrences share one translated post but each need their own
	 * `event_date` URL arg, so only the id-independent parts are cached
	 * here.
	 *
	 * @var array<int, array{title: string, permalink: string}|null>
	 */
	private static $post_data = array();

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

		// A post-linked event date can still route its title/url elsewhere
		// (an admin-configured external URL, or a different junction-linked
		// post) via link_type; only a plain 'post' link means title/url
		// genuinely came from $event_id's own post, which is the only case
		// this service knows how to swap for a translation.
		if ( 'post' !== ( $occurrence['link_type'] ?? null ) ) {
			return $occurrence;
		}

		$event_id      = (int) $occurrence['event_id'];
		$translated_id = self::resolve_translated_id( $event_id, $language );

		if ( ! $translated_id || $translated_id === $event_id ) {
			return $occurrence;
		}

		$post_data = self::resolve_post_data( $translated_id );
		if ( null === $post_data ) {
			return $occurrence;
		}

		$url = $post_data['permalink'];
		if ( 'generated' === $occurrence['occurrence_type'] ) {
			$url = add_query_arg( 'event_date', OccurrenceDateParam::format_datetime( $occurrence['start'] ), $url );
		}

		$occurrence['title'] = $post_data['title'];
		$occurrence['url']   = $url;

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

	/**
	 * Resolve (and cache) a translated post's title/permalink, or null when
	 * it's unusable (not published, or no permalink).
	 *
	 * @param int $translated_id Translated post ID.
	 * @return array{title: string, permalink: string}|null
	 */
	private static function resolve_post_data( $translated_id ) {
		if ( array_key_exists( $translated_id, self::$post_data ) ) {
			return self::$post_data[ $translated_id ];
		}

		$data = null;

		if ( 'publish' === get_post_status( $translated_id ) ) {
			$permalink = get_permalink( $translated_id );
			if ( $permalink ) {
				$data = array(
					'title'     => get_the_title( $translated_id ),
					'permalink' => $permalink,
				);
			}
		}

		self::$post_data[ $translated_id ] = $data;

		return $data;
	}
}
