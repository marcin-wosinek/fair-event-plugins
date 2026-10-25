<?php
/**
 * Weekly summary for operator links.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

defined( 'WPINC' ) || die;

/**
 * Builds the weekly summary an operator copies from a source page's Events
 * Week block.
 *
 * Every part of the text comes from Fair Events' own summary code with the
 * block's own event selection, page and language, so the copied text is the
 * one the block's "Copy summary" button gives for the same week. Only public
 * events are ever listed: drafts are excluded, and a block set to show them
 * can't back a link.
 */
class WeeklySummary {

	/**
	 * Fair Events classes the summary is built with.
	 */
	private const REQUIRED_CLASSES = array(
		'\FairEvents\Helpers\WeekViewParam',
		'\FairEvents\Services\EventsWeekSummary',
		'\FairEvents\Services\EventsWeekSummaryFormatter',
		'\FairEvents\Settings\Settings',
	);

	/**
	 * Build the summary of a source page's Events Week block for a week.
	 *
	 * @param \WP_Post $page     Source page.
	 * @param string   $anchor   Anchor of the Events Week block on that page.
	 * @param string   $week_raw Requested `YYYY-Www` week; anything else
	 *                           shows the current week, as the block does.
	 * @return array|\WP_Error {
	 *     @type string  $text        Summary text.
	 *     @type string  $title       Source page title.
	 *     @type string  $url         Source page permalink.
	 *     @type string  $range       Localized date range of the week.
	 *     @type string  $start       First 'Y-m-d' date of the week.
	 *     @type string  $end         Last 'Y-m-d' date of the week.
	 *     @type int     $year        ISO year shown.
	 *     @type int     $week        ISO week shown.
	 *     @type bool    $week_valid  Whether a requested week was shown, rather than the current one.
	 *     @type array   $prev        ISO year and week before the one shown.
	 *     @type array   $next        ISO year and week after the one shown.
	 *     @type array[] $events      Each with `when`, `title` and `url`.
	 * }
	 */
	public function build( \WP_Post $page, $anchor, $week_raw ) {
		foreach ( self::REQUIRED_CLASSES as $class ) {
			if ( ! class_exists( $class ) ) {
				return new \WP_Error( 'fair_events_outdated', __( 'Weekly summaries need an up-to-date Fair Events plugin.', 'fair-events-experimental' ) );
			}
		}
		if ( ! method_exists( '\FairEvents\Services\EventsWeekSummaryFormatter', 'when' ) ) {
			return new \WP_Error( 'fair_events_outdated', __( 'Weekly summaries need an up-to-date Fair Events plugin.', 'fair-events-experimental' ) );
		}

		if ( 'publish' !== $page->post_status || '' !== $page->post_password || ! is_post_publicly_viewable( $page ) ) {
			return new \WP_Error( 'page_not_public', __( 'This weekly summary is not available because its page is not public.', 'fair-events-experimental' ) );
		}

		$selection = $this->selection( $page, $anchor );
		if ( is_wp_error( $selection ) ) {
			return $selection;
		}

		$parsed = \FairEvents\Helpers\WeekViewParam::parse( (string) $week_raw );
		$iso    = $parsed ? $parsed : \FairEvents\Helpers\WeekViewParam::current();
		$week   = \FairEvents\Services\EventsWeekSummary::iso_week_boundaries(
			$iso['year'],
			$iso['week'],
			\FairEvents\Settings\Settings::get_start_of_week()
		);

		// The summary is in the page's language, as the block on that page
		// shows it, whatever language the request would otherwise use.
		$language = function_exists( 'pll_get_post_language' ) ? pll_get_post_language( $page->ID ) : false;
		$locale   = function_exists( 'pll_get_post_language' ) ? pll_get_post_language( $page->ID, 'locale' ) : '';
		$switched = $locale && switch_to_locale( $locale );

		try {
			$occurrences = \FairEvents\Services\EventsWeekSummary::occurrences(
				$week,
				array(
					'categories'         => $selection['categories'],
					'event_source_slugs' => $selection['eventSources'],
					'include_drafts'     => false,
				),
				$language ? $language : false
			);
			// Fair Events drafts never reach a public link, even when the
			// feed would list them for a logged-in organizer.
			$occurrences = array_values(
				array_filter(
					$occurrences,
					static fn( $occurrence ) => empty( $occurrence['is_draft'] )
				)
			);

			$text   = \FairEvents\Services\EventsWeekSummary::format( $occurrences, $week, \FairEvents\Services\EventsWeekSummary::page_label( $page->ID ) );
			$range  = \FairEvents\Services\EventsWeekSummary::range_title( $week['start'], $week['end'] );
			$events = array_map(
				static fn( $occurrence ) => array(
					'when'  => \FairEvents\Services\EventsWeekSummaryFormatter::when( $occurrence, $week['start'], $week['end'] ),
					'title' => (string) ( $occurrence['title'] ?? '' ),
					'url'   => (string) ( $occurrence['url'] ?? '' ),
				),
				$occurrences
			);
		} finally {
			if ( $switched ) {
				restore_previous_locale();
			}
		}

		return array(
			'text'       => $text,
			'title'      => get_the_title( $page ),
			'url'        => (string) get_permalink( $page ),
			'range'      => $range,
			'start'      => $week['start'],
			'end'        => $week['end'],
			'year'       => $iso['year'],
			'week'       => $iso['week'],
			'week_valid' => null !== $parsed,
			'prev'       => \FairEvents\Services\EventsWeekSummary::offset_iso_week( $iso['year'], $iso['week'], -1 ),
			'next'       => \FairEvents\Services\EventsWeekSummary::offset_iso_week( $iso['year'], $iso['week'], 1 ),
			'events'     => $events,
		);
	}

	/**
	 * Event selection of the page's Events Week block with the anchor.
	 *
	 * @param \WP_Post $page   Source page.
	 * @param string   $anchor Block anchor.
	 * @return array|\WP_Error `categories` and `eventSources` attributes.
	 */
	private function selection( \WP_Post $page, $anchor ) {
		if ( ! WeeklySummarySelection::is_valid_anchor( $anchor ) ) {
			return new \WP_Error( 'not_found', __( 'This page has no events calendar for this link. Check the link with the page organizer.', 'fair-events-experimental' ) );
		}

		$result = WeeklySummarySelection::find(
			parse_blocks( $page->post_content ),
			$anchor,
			static function ( $ref ) {
				$pattern = get_post( $ref );
				if ( ! $pattern || 'wp_block' !== $pattern->post_type || 'publish' !== $pattern->post_status ) {
					return null;
				}
				return parse_blocks( $pattern->post_content );
			}
		);

		switch ( $result['status'] ) {
			case WeeklySummarySelection::FOUND:
				return $result['attributes'];
			case WeeklySummarySelection::AMBIGUOUS:
				return new \WP_Error( 'ambiguous', __( 'More than one events calendar on this page uses this link’s name, so the summary can’t tell which to show. Give each calendar a unique HTML anchor.', 'fair-events-experimental' ) );
			case WeeklySummarySelection::SHOWS_DRAFTS:
				return new \WP_Error( 'shows_drafts', __( 'This events calendar also shows draft events, so it can’t be shared through a public link. Turn off showing drafts on the calendar to use it.', 'fair-events-experimental' ) );
			default:
				return new \WP_Error( 'not_found', __( 'This page has no events calendar for this link. Check the link with the page organizer.', 'fair-events-experimental' ) );
		}
	}
}
