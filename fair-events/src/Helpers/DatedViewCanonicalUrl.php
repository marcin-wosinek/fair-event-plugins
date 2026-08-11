<?php
/**
 * Canonical URL resolution for the events-calendar and events-week blocks'
 * dated views.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * The events-calendar and events-week blocks let visitors browse other
 * months/weeks via `?calendar_month=`+`?calendar_year=` and `?week_view=`,
 * but every dated view otherwise reports the same canonical URL as the
 * page's default view — search engines then treat genuinely different
 * content (a different month/week of events) as duplicates of one page.
 *
 * This helper decides when a request's dated-view params earn their own
 * canonical URL: the relevant block must actually be on the page, the param
 * must differ from "now" (the default view already canonicalizes there),
 * and the param must fall within a bounded window so canonicals don't
 * balloon into an unbounded, mostly-empty crawl surface. A param whose block
 * isn't on the page (left over from navigating the other view) is dropped,
 * so two requests that render identical content always resolve to the same
 * canonical URL.
 *
 * Known limitation: `has_block()` only sees literal serialized block markup
 * in post_content, so a calendar/week block inserted via a synced
 * pattern/reusable block reference won't be detected and that page's
 * canonical will drop the param even though the block renders. No existing
 * code in this plugin resolves synced-pattern references either, so this
 * matches current practice rather than regressing it.
 */
class DatedViewCanonicalUrl {

	/**
	 * How many months either side of "now" a calendar_month/year param still
	 * earns its own canonical.
	 */
	const CALENDAR_WINDOW_MONTHS = 3;

	/**
	 * How many weeks either side of "now" a week_view param still earns its
	 * own canonical.
	 */
	const WEEK_WINDOW_WEEKS = 12;

	/**
	 * Resolve the canonical URL for the current request against a post.
	 *
	 * @param \WP_Post $post     The queried post.
	 * @param string   $base_url The plain page URL (WordPress' own canonical).
	 * @return string Canonical URL.
	 */
	public static function for_post( \WP_Post $post, string $base_url ): string {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$url_month = isset( $_GET['calendar_month'] ) ? sanitize_text_field( wp_unslash( $_GET['calendar_month'] ) ) : '';
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$url_year = isset( $_GET['calendar_year'] ) ? sanitize_text_field( wp_unslash( $_GET['calendar_year'] ) ) : '';
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$week_raw = isset( $_GET['week_view'] ) ? sanitize_text_field( wp_unslash( $_GET['week_view'] ) ) : '';

		$has_calendar_block = has_block( 'fair-events/events-calendar', $post );

		// Mirrors events-calendar/render.php's own precedence: a URL param
		// wins, otherwise fall back to the block's own currentMonth/
		// currentYear attributes. Without this, a block whose attributes
		// render a non-default month (with no URL param present) would
		// render one month but canonicalize to the bare page URL.
		$calendar_month_raw = $url_month;
		$calendar_year_raw  = $url_year;
		if ( $has_calendar_block && ( '' === $url_month || '' === $url_year ) ) {
			$block_attrs        = self::calendar_block_attributes( $post );
			$calendar_month_raw = '' !== $url_month ? $url_month : (string) ( $block_attrs['currentMonth'] ?? '' );
			$calendar_year_raw  = '' !== $url_year ? $url_year : (string) ( $block_attrs['currentYear'] ?? '' );
		}

		return self::resolve_url(
			$base_url,
			$has_calendar_block,
			CalendarMonthParam::parse( $calendar_month_raw, $calendar_year_raw ),
			CalendarMonthParam::current(),
			has_block( 'fair-events/events-week', $post ),
			WeekViewParam::parse( $week_raw ),
			WeekViewParam::current()
		);
	}

	/**
	 * Read the events-calendar block's attributes from a post's content, so
	 * for_post() can fall back to its currentMonth/currentYear the same way
	 * events-calendar/render.php does when no URL param is present.
	 *
	 * @param \WP_Post $post The queried post.
	 * @return array Attributes of the first fair-events/events-calendar
	 *               block found, or an empty array if none is present.
	 */
	private static function calendar_block_attributes( \WP_Post $post ): array {
		$attrs = self::find_block_attrs( parse_blocks( $post->post_content ), 'fair-events/events-calendar' );

		return $attrs ?? array();
	}

	/**
	 * Recursively search a parsed block tree for the first block matching a
	 * given name, returning its attributes.
	 *
	 * @param array  $blocks     Parsed blocks (parse_blocks() output, or an innerBlocks slice).
	 * @param string $block_name Fully-qualified block name to find.
	 * @return array|null The matching block's attrs (possibly empty), or null if not found.
	 */
	private static function find_block_attrs( array $blocks, string $block_name ): ?array {
		foreach ( $blocks as $block ) {
			if ( isset( $block['blockName'] ) && $block_name === $block['blockName'] ) {
				return $block['attrs'] ?? array();
			}

			if ( ! empty( $block['innerBlocks'] ) ) {
				$found = self::find_block_attrs( $block['innerBlocks'], $block_name );
				if ( null !== $found ) {
					return $found;
				}
			}
		}

		return null;
	}

	/**
	 * Pure canonical-URL decision.
	 *
	 * @param string                                  $base_url           The plain page URL.
	 * @param bool                                    $has_calendar_block Whether the events-calendar block is on the page.
	 * @param array{month: string, year: string}|null $calendar           The request's parsed calendar param, or null if absent/invalid.
	 * @param array{month: string, year: string}      $calendar_now       The current month/year.
	 * @param bool                                    $has_week_block     Whether the events-week block is on the page.
	 * @param array{year: int, week: int}|null        $week               The request's parsed week param, or null if absent/invalid.
	 * @param array{year: int, week: int}             $week_now           The current ISO year/week.
	 * @return string Canonical URL.
	 */
	public static function resolve_url(
		string $base_url,
		bool $has_calendar_block,
		?array $calendar,
		array $calendar_now,
		bool $has_week_block,
		?array $week,
		array $week_now
	): string {
		$url = $base_url;

		if ( self::calendar_param_is_indexable( $has_calendar_block, $calendar, $calendar_now ) ) {
			$url = add_query_arg( 'calendar_month', $calendar['month'], $url );
			$url = add_query_arg( 'calendar_year', $calendar['year'], $url );
		}

		if ( self::week_param_is_indexable( $has_week_block, $week, $week_now ) ) {
			$url = add_query_arg( 'week_view', WeekViewParam::format( $week['year'], $week['week'] ), $url );
		}

		return $url;
	}

	/**
	 * Whether a calendar param earns its own canonical.
	 *
	 * @param bool                                    $has_calendar_block Whether the events-calendar block is on the page.
	 * @param array{month: string, year: string}|null $calendar           The request's parsed calendar param.
	 * @param array{month: string, year: string}      $calendar_now       The current month/year.
	 * @return bool
	 */
	private static function calendar_param_is_indexable( bool $has_calendar_block, ?array $calendar, array $calendar_now ): bool {
		if ( ! $has_calendar_block || null === $calendar ) {
			return false;
		}

		if ( $calendar['month'] === $calendar_now['month'] && $calendar['year'] === $calendar_now['year'] ) {
			return false;
		}

		$distance = self::month_distance( $calendar, $calendar_now );

		return $distance <= self::CALENDAR_WINDOW_MONTHS;
	}

	/**
	 * Whether a week param earns its own canonical.
	 *
	 * @param bool                             $has_week_block Whether the events-week block is on the page.
	 * @param array{year: int, week: int}|null $week           The request's parsed week param.
	 * @param array{year: int, week: int}      $week_now       The current ISO year/week.
	 * @return bool
	 */
	private static function week_param_is_indexable( bool $has_week_block, ?array $week, array $week_now ): bool {
		if ( ! $has_week_block || null === $week ) {
			return false;
		}

		if ( $week['year'] === $week_now['year'] && $week['week'] === $week_now['week'] ) {
			return false;
		}

		$distance = self::week_distance( $week, $week_now );

		return $distance <= self::WEEK_WINDOW_WEEKS;
	}

	/**
	 * Linear month distance between two month/year pairs.
	 *
	 * @param array{month: string, year: string} $a First month/year pair.
	 * @param array{month: string, year: string} $b Second month/year pair.
	 * @return int Absolute number of months between the two.
	 */
	private static function month_distance( array $a, array $b ): int {
		$a_ordinal = ( (int) $a['year'] * 12 ) + (int) $a['month'];
		$b_ordinal = ( (int) $b['year'] * 12 ) + (int) $b['month'];

		return abs( $a_ordinal - $b_ordinal );
	}

	/**
	 * Week distance between two ISO year/week pairs, via plain PHP date
	 * arithmetic (no WP calls, so this stays pure/unit-testable).
	 *
	 * @param array{year: int, week: int} $a First ISO year/week pair.
	 * @param array{year: int, week: int} $b Second ISO year/week pair.
	 * @return int Absolute number of weeks between the two.
	 */
	private static function week_distance( array $a, array $b ): int {
		$a_date = new \DateTime();
		$a_date->setISODate( $a['year'], $a['week'] );

		$b_date = new \DateTime();
		$b_date->setISODate( $b['year'], $b['week'] );

		$days = (int) $a_date->diff( $b_date )->days;

		return (int) round( $days / 7 );
	}
}
