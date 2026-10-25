<?php
/**
 * Weekly summary for operator links.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

defined( 'WPINC' ) || die;

/**
 * Builds the weekly summary an operator copies for an event feed.
 *
 * The text comes from Fair Events' SummaryBuilder, the code behind the weekly
 * notification, with the feed's events and its page as heading and language.
 * It is the text an Events Week block on that page, showing only that feed,
 * copies for the same week. Only public events are ever listed.
 */
class WeeklySummary {

	/**
	 * Fair Events classes the summary is built with.
	 */
	private const REQUIRED_CLASSES = array(
		'\FairEvents\Helpers\WeekViewParam',
		'\FairEvents\Services\EventsWeekSummary',
		'\FairEvents\Notifications\SummaryBuilder',
		'\FairEvents\Database\EventSourceRepository',
		'\FairEvents\Settings\Settings',
	);

	/**
	 * Whether a value from a link can be an event feed slug.
	 *
	 * @param string $slug Slug from the link.
	 * @return bool
	 */
	public static function is_valid_slug( $slug ) {
		return is_string( $slug ) && '' !== $slug && sanitize_title( $slug ) === $slug;
	}

	/**
	 * Build the summary of an event feed for a week.
	 *
	 * @param string $slug     Event feed slug.
	 * @param string $week_raw Requested `YYYY-Www` week; anything else
	 *                         shows the current week, as Events Week does.
	 * @return array|\WP_Error {
	 *     @type string  $feed        Event feed name.
	 *     @type string  $text        Summary text.
	 *     @type string  $title       Feed page title.
	 *     @type string  $url         Feed page permalink.
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
	public function build( $slug, $week_raw ) {
		foreach ( self::REQUIRED_CLASSES as $class ) {
			if ( ! class_exists( $class ) ) {
				return new \WP_Error( 'fair_events_outdated', __( 'Weekly summaries need an up-to-date Fair Events plugin.', 'fair-events-experimental' ) );
			}
		}
		if ( ! method_exists( '\FairEvents\Notifications\SummaryBuilder', 'check' ) || ! method_exists( '\FairEvents\Notifications\SummaryBuilder', 'build' ) ) {
			return new \WP_Error( 'fair_events_outdated', __( 'Weekly summaries need an up-to-date Fair Events plugin.', 'fair-events-experimental' ) );
		}

		$source = self::is_valid_slug( $slug ) ? ( new \FairEvents\Database\EventSourceRepository() )->get_by_slug( $slug ) : null;
		if ( ! $source || empty( $source['enabled'] ) ) {
			return new \WP_Error( 'not_found', __( 'This weekly summary link doesn’t match an enabled event feed. Check the link with the site organizer.', 'fair-events-experimental' ) );
		}
		if ( empty( $source['page_id'] ) ) {
			return new \WP_Error( 'missing_page', __( 'This event feed has no page, which gives the summary its title and link. Choose the feed’s page in Event Feeds to use this link.', 'fair-events-experimental' ) );
		}

		$builder = new \FairEvents\Notifications\SummaryBuilder();
		$check   = $builder->check( $source['slug'], (int) $source['page_id'] );
		if ( is_wp_error( $check ) ) {
			return $check;
		}

		$parsed = \FairEvents\Helpers\WeekViewParam::parse( (string) $week_raw );
		$iso    = $parsed ? $parsed : \FairEvents\Helpers\WeekViewParam::current();
		$week   = \FairEvents\Services\EventsWeekSummary::iso_week_boundaries(
			$iso['year'],
			$iso['week'],
			\FairEvents\Settings\Settings::get_start_of_week()
		);

		$summary = $builder->build(
			array(
				'source_slug' => $source['slug'],
				'page_id'     => (int) $source['page_id'],
			),
			$week
		);
		if ( is_wp_error( $summary ) ) {
			return $summary;
		}

		return array(
			'feed'       => (string) $source['name'],
			'text'       => $summary['text'],
			'title'      => $summary['title'],
			'url'        => $summary['url'],
			'range'      => $summary['range'],
			'start'      => $week['start'],
			'end'        => $week['end'],
			'year'       => $iso['year'],
			'week'       => $iso['week'],
			'week_valid' => null !== $parsed,
			'prev'       => \FairEvents\Services\EventsWeekSummary::offset_iso_week( $iso['year'], $iso['week'], -1 ),
			'next'       => \FairEvents\Services\EventsWeekSummary::offset_iso_week( $iso['year'], $iso['week'], 1 ),
			'events'     => $summary['events'],
		);
	}
}
