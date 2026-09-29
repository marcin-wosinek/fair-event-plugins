<?php
/**
 * Builds the weekly notification summary.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WeeklyNotifications;

defined( 'WPINC' ) || die;

/**
 * Produces the same text as the public Events Week copy-summary action for
 * the selected source, calendar page and week.
 *
 * The selected page must publicly show an Events Week block for exactly the
 * selected source, without extra categories or drafts, so the notification
 * never contains events the page itself does not show.
 */
class SummaryBuilder {
	public const BLOCK_NAME   = 'fair-events/events-week';
	private const MAX_DEPTH   = 5;
	private const SUMMARY_API = '\FairEvents\Services\EventsWeekSummary';

	/**
	 * Check that the source and page can produce a public summary.
	 *
	 * @param string $source_slug Event source slug.
	 * @param int    $page_id     Calendar page ID.
	 * @return true|\WP_Error
	 */
	public function check( $source_slug, $page_id ) {
		if ( ! class_exists( self::SUMMARY_API ) || ! class_exists( '\FairEvents\Database\EventSourceRepository' ) ) {
			return new \WP_Error( 'fair_events_outdated', __( 'Update Fair Events to use weekly notifications.', 'fair-events-experimental' ) );
		}

		if ( '' === $source_slug ) {
			return new \WP_Error( 'missing_source', __( 'Choose an event source.', 'fair-events-experimental' ) );
		}
		$source = ( new \FairEvents\Database\EventSourceRepository() )->get_by_slug( $source_slug );
		if ( ! $source || empty( $source['enabled'] ) ) {
			return new \WP_Error( 'invalid_source', __( 'The selected event source does not exist or is disabled.', 'fair-events-experimental' ) );
		}

		$page = $page_id ? get_post( $page_id ) : null;
		if ( ! $page ) {
			return new \WP_Error( 'missing_page', __( 'Choose the public calendar page.', 'fair-events-experimental' ) );
		}
		if ( 'publish' !== $page->post_status || ! empty( $page->post_password ) || ! is_post_publicly_viewable( $page ) ) {
			return new \WP_Error( 'page_not_public', __( 'The calendar page must be published and publicly visible.', 'fair-events-experimental' ) );
		}

		$blocks = self::find_week_blocks( parse_blocks( $page->post_content ) );
		if ( empty( $blocks ) ) {
			return new \WP_Error( 'page_without_calendar', __( 'The calendar page has no Events Week View block.', 'fair-events-experimental' ) );
		}
		foreach ( $blocks as $block ) {
			if ( self::block_matches( $block['attrs'] ?? array(), $source_slug ) ) {
				return true;
			}
		}

		return new \WP_Error(
			'calendar_mismatch',
			__( 'The Events Week View block on the calendar page must show only the selected event source, with no extra categories and no drafts.', 'fair-events-experimental' )
		);
	}

	/**
	 * Build the summary for a week.
	 *
	 * @param array                             $settings Weekly notification settings.
	 * @param array{start: string, end: string} $week     Week boundaries.
	 * @return array{text: string, occurrence_count: int}|\WP_Error
	 */
	public function build( array $settings, array $week ) {
		$check = $this->check( $settings['source_slug'], (int) $settings['page_id'] );
		if ( is_wp_error( $check ) ) {
			return $check;
		}

		$page_id  = (int) $settings['page_id'];
		$language = function_exists( 'pll_get_post_language' ) ? pll_get_post_language( $page_id ) : false;
		$locale   = function_exists( 'pll_get_post_language' ) ? pll_get_post_language( $page_id, 'locale' ) : '';
		$switched = $locale && switch_to_locale( $locale );

		try {
			$summary     = self::SUMMARY_API;
			$occurrences = $summary::occurrences(
				$week,
				array(
					'categories'         => array(),
					'event_source_slugs' => array( $settings['source_slug'] ),
					'include_drafts'     => false,
				),
				$language ? $language : false
			);
			$text        = $summary::format( $occurrences, $week, $summary::page_label( $page_id ) );
		} finally {
			if ( $switched ) {
				restore_previous_locale();
			}
		}

		return array(
			'text'             => $text,
			'occurrence_count' => count( $occurrences ),
		);
	}

	/**
	 * Whether a block's attributes show exactly the source, publicly.
	 *
	 * @param array  $attrs       Block attributes.
	 * @param string $source_slug Event source slug.
	 * @return bool
	 */
	public static function block_matches( array $attrs, $source_slug ) {
		$sources = array_values( array_unique( array_map( 'strval', (array) ( $attrs['eventSources'] ?? array() ) ) ) );

		return array( $source_slug ) === $sources
			&& empty( $attrs['categories'] )
			&& empty( $attrs['showDrafts'] );
	}

	/**
	 * Events Week blocks in a block tree, including synced patterns.
	 *
	 * @param array[] $blocks Parsed blocks.
	 * @param int     $depth  Nesting depth, to stop pattern reference loops.
	 * @return array[]
	 */
	public static function find_week_blocks( array $blocks, $depth = 0 ) {
		$found = array();
		if ( $depth > self::MAX_DEPTH ) {
			return $found;
		}

		foreach ( $blocks as $block ) {
			$name = $block['blockName'] ?? '';
			if ( self::BLOCK_NAME === $name ) {
				$found[] = $block;
			} elseif ( 'core/block' === $name && ! empty( $block['attrs']['ref'] ) ) {
				$pattern = get_post( (int) $block['attrs']['ref'] );
				if ( $pattern && 'wp_block' === $pattern->post_type && 'publish' === $pattern->post_status ) {
					$found = array_merge( $found, self::find_week_blocks( parse_blocks( $pattern->post_content ), $depth + 1 ) );
				}
			}
			if ( ! empty( $block['innerBlocks'] ) ) {
				$found = array_merge( $found, self::find_week_blocks( $block['innerBlocks'], $depth + 1 ) );
			}
		}

		return $found;
	}
}
