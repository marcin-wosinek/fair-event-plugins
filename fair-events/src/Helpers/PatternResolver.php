<?php
/**
 * Pattern resolution and classification for the Events List block.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * Resolves a block's `displayPattern` attribute (a bundled pattern name or a
 * `wp_block:{id}` synced pattern reference) to its content, and classifies
 * that content as a Query Loop layout (post-backed events only) or a
 * per-event layout (every occurrence source).
 */
class PatternResolver {

	const TYPE_QUERY_LOOP  = 'query-loop';
	const TYPE_PER_EVENT   = 'per-event';
	const TYPE_UNAVAILABLE = 'unavailable';

	/**
	 * Resolve a display pattern attribute value to its content and type.
	 *
	 * @param string $pattern_name Bundled pattern name or `wp_block:{id}`.
	 * @return array{type: string, content: string, name: string} Resolution result.
	 *              `type` is one of the TYPE_* constants; `content` is empty
	 *              when `type` is TYPE_UNAVAILABLE.
	 */
	public static function resolve( $pattern_name ) {
		$pattern_name = (string) $pattern_name;

		$content = '' !== $pattern_name && 0 === strpos( $pattern_name, 'wp_block:' )
			? self::resolve_synced_pattern( $pattern_name )
			: self::resolve_registered_pattern( $pattern_name );

		if ( null === $content || '' === $content ) {
			return array(
				'type'    => self::TYPE_UNAVAILABLE,
				'content' => '',
				'name'    => $pattern_name,
			);
		}

		return array(
			'type'    => self::classify( $content ),
			'content' => $content,
			'name'    => $pattern_name,
		);
	}

	/**
	 * Classify pattern content as Query Loop (post-backed only) or per-event
	 * (supports every occurrence source).
	 *
	 * A Query Loop pattern nests `core/query` (optionally with
	 * `core/post-template`); WordPress's Query Loop cannot represent
	 * standalone, iCal, or API occurrence DTOs, only real posts.
	 *
	 * @param string $content Pattern block markup.
	 * @return string One of TYPE_QUERY_LOOP or TYPE_PER_EVENT.
	 */
	public static function classify( $content ) {
		if ( false !== strpos( $content, '<!-- wp:query' ) || false !== strpos( $content, '<!-- wp:post-template' ) ) {
			return self::TYPE_QUERY_LOOP;
		}

		return self::TYPE_PER_EVENT;
	}

	/**
	 * Resolve a `wp_block:{id}` synced-pattern reference to its post content.
	 *
	 * @param string $pattern_name Attribute value, e.g. 'wp_block:42'.
	 * @return string|null Post content, or null if the block no longer exists.
	 */
	private static function resolve_synced_pattern( $pattern_name ) {
		$block_id = absint( str_replace( 'wp_block:', '', $pattern_name ) );

		if ( ! $block_id ) {
			return null;
		}

		$block_post = get_post( $block_id );

		if ( ! $block_post || 'wp_block' !== $block_post->post_type ) {
			return null;
		}

		return $block_post->post_content;
	}

	/**
	 * Resolve a bundled (PHP-registered) pattern name to its content.
	 *
	 * @param string $pattern_name Registered pattern name, e.g. 'fair-events/event-list'.
	 * @return string|null Pattern content, or null if no longer registered.
	 */
	private static function resolve_registered_pattern( $pattern_name ) {
		if ( '' === $pattern_name || ! class_exists( '\WP_Block_Patterns_Registry' ) ) {
			return null;
		}

		$all_patterns = \WP_Block_Patterns_Registry::get_instance()->get_all_registered();

		foreach ( $all_patterns as $pattern ) {
			if ( isset( $pattern['name'] ) && $pattern['name'] === $pattern_name ) {
				return $pattern['content'];
			}
		}

		return null;
	}
}
