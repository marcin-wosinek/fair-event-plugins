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
 * the selected source and week, plus the same content as structured data.
 *
 * The source decides which public events are listed. The selected page only
 * supplies the heading's title and link and the language, whatever its
 * content, so it must be a published, publicly visible page.
 */
class SummaryBuilder {
	private const SUMMARY_API = '\FairEvents\Services\EventsWeekSummary';

	/**
	 * Check that the source and page can produce a public summary.
	 *
	 * @param string $source_slug Event source slug.
	 * @param int    $page_id     Page that heads the message.
	 * @return true|\WP_Error
	 */
	public function check( $source_slug, $page_id ) {
		if ( ! class_exists( self::SUMMARY_API ) || ! class_exists( '\FairEvents\Database\EventSourceRepository' )
			|| ! method_exists( '\FairEvents\Services\EventsWeekSummaryFormatter', 'when' ) ) {
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
			return new \WP_Error( 'missing_page', __( 'Choose the page that heads the message.', 'fair-events-experimental' ) );
		}
		if ( 'page' !== $page->post_type || 'publish' !== $page->post_status || ! empty( $page->post_password ) || ! is_post_publicly_viewable( $page ) ) {
			return new \WP_Error( 'page_not_public', __( 'The selected page must be published and publicly visible.', 'fair-events-experimental' ) );
		}

		return true;
	}

	/**
	 * Build the summary for a week.
	 *
	 * @param array                             $settings Weekly notification settings.
	 * @param array{start: string, end: string} $week     Week boundaries.
	 * @return array{text: string, occurrence_count: int, title: string, url: string, range: string, events: array[]}|\WP_Error
	 *     `text` is the copy-summary text; the other fields carry the same
	 *     content as data, for providers that format messages themselves.
	 *     Each event has `when`, `title` and `url`.
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
			$range       = $summary::range_title( $week['start'], $week['end'] );
			$events      = array_map(
				static fn( $occurrence ) => array(
					'when'  => \FairEvents\Services\EventsWeekSummaryFormatter::when( $occurrence, $week['start'], $week['end'] ),
					'title' => self::plain( $occurrence['title'] ?? '' ),
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
			'text'             => $text,
			'occurrence_count' => count( $occurrences ),
			'title'            => self::plain( get_the_title( $page_id ) ),
			'url'              => (string) get_permalink( $page_id ),
			'range'            => $range,
			'events'           => $events,
		);
	}

	/**
	 * Title as plain text, with HTML entities such as &#8217; decoded.
	 *
	 * @param string $title Title.
	 * @return string
	 */
	private static function plain( $title ) {
		return trim( html_entity_decode( (string) $title, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
	}
}
