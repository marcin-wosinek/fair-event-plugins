<?php
/**
 * Events Week block lookup for operator weekly-summary links.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

defined( 'WPINC' ) || die;

/**
 * Finds the Events Week block an operator link names by its HTML anchor.
 *
 * The link reuses the block's own event selection, so the summary always
 * follows the calendar it was set up for. Exactly one block on the page may
 * carry the anchor: a missing or repeated anchor never falls back to another
 * calendar. Blocks inside containers and synced patterns are found too.
 */
class WeeklySummarySelection {

	/**
	 * Block name of the Events Week block.
	 */
	public const BLOCK_NAME = 'fair-events/events-week';

	/**
	 * Lookup result: the block was found and can back a public link.
	 */
	public const FOUND = 'found';

	/**
	 * Lookup result: no Events Week block carries the anchor.
	 */
	public const NOT_FOUND = 'not_found';

	/**
	 * Lookup result: more than one Events Week block carries the anchor.
	 */
	public const AMBIGUOUS = 'ambiguous';

	/**
	 * Lookup result: the block also shows drafts, so it is not public-only.
	 */
	public const SHOWS_DRAFTS = 'shows_drafts';

	/**
	 * Whether a value can be an anchor of an operator link.
	 *
	 * Anchors are HTML ids set in the block's Advanced panel; this accepts
	 * the characters WordPress keeps in them.
	 *
	 * @param string $anchor Anchor from the link.
	 * @return bool
	 */
	public static function is_valid_anchor( $anchor ) {
		return is_string( $anchor ) && 1 === preg_match( '/^[A-Za-z0-9_:.\-]{1,100}$/', $anchor );
	}

	/**
	 * Find the Events Week block carrying an anchor.
	 *
	 * @param array[]  $blocks         Parsed blocks, as parse_blocks() returns them.
	 * @param string   $anchor         Anchor from the link.
	 * @param callable $resolve_synced Receives a synced pattern ID and returns its
	 *                                 parsed blocks, or null when it can't be shown.
	 * @return array{status: string, attributes?: array} `attributes` with
	 *     `categories` and `eventSources` when the status is FOUND.
	 */
	public static function find( array $blocks, $anchor, callable $resolve_synced ) {
		$matches = array();
		self::collect( $blocks, $anchor, $resolve_synced, array(), $matches );

		if ( empty( $matches ) ) {
			return array( 'status' => self::NOT_FOUND );
		}
		if ( count( $matches ) > 1 ) {
			return array( 'status' => self::AMBIGUOUS );
		}

		$attributes = $matches[0];
		if ( ! empty( $attributes['showDrafts'] ) ) {
			return array( 'status' => self::SHOWS_DRAFTS );
		}

		return array(
			'status'     => self::FOUND,
			'attributes' => array(
				'categories'   => array_values( array_map( 'intval', (array) ( $attributes['categories'] ?? array() ) ) ),
				'eventSources' => array_values( array_map( 'strval', (array) ( $attributes['eventSources'] ?? array() ) ) ),
			),
		);
	}

	/**
	 * Collect the attributes of every matching block, depth first.
	 *
	 * @param array[]  $blocks         Parsed blocks.
	 * @param string   $anchor         Anchor to match.
	 * @param callable $resolve_synced Synced pattern resolver.
	 * @param int[]    $visited        Synced pattern IDs on the current path.
	 * @param array[]  $matches        Attributes of matching blocks, appended to.
	 * @return void
	 */
	private static function collect( array $blocks, $anchor, callable $resolve_synced, array $visited, array &$matches ) {
		foreach ( $blocks as $block ) {
			if ( ! is_array( $block ) ) {
				continue;
			}
			$name       = $block['blockName'] ?? null;
			$attributes = is_array( $block['attrs'] ?? null ) ? $block['attrs'] : array();

			if ( self::BLOCK_NAME === $name && ( $attributes['anchor'] ?? null ) === $anchor ) {
				$matches[] = $attributes;
			}

			if ( 'core/block' === $name && ! empty( $attributes['ref'] ) ) {
				$ref = (int) $attributes['ref'];
				// A pattern that includes itself would otherwise loop forever.
				if ( ! in_array( $ref, $visited, true ) ) {
					$synced = $resolve_synced( $ref );
					if ( is_array( $synced ) ) {
						self::collect( $synced, $anchor, $resolve_synced, array_merge( $visited, array( $ref ) ), $matches );
					}
				}
			}

			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				self::collect( $block['innerBlocks'], $anchor, $resolve_synced, $visited, $matches );
			}
		}
	}
}
