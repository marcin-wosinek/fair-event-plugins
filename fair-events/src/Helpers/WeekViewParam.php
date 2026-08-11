<?php
/**
 * Parse and format the public `week_view` URL param.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * The events-week block reads which ISO week to display from
 * `?week_view=YYYY-Www` (falling back to the current week). This helper is
 * the single place that validates/formats that value, so the block's own
 * render and the dated-view canonical-URL logic share one implementation
 * instead of two regexes drifting apart.
 */
class WeekViewParam {

	/**
	 * Parse a raw `YYYY-Www` string into its year/week parts.
	 *
	 * @param string $raw Raw URL param value.
	 * @return array{year: int, week: int}|null The parsed pair, or null if
	 *                                           the value doesn't match the
	 *                                           expected format/range.
	 */
	public static function parse( string $raw ): ?array {
		if ( ! preg_match( '/^(\d{4})-W(\d{2})$/', $raw, $matches ) ) {
			return null;
		}

		$year = (int) $matches[1];
		$week = (int) $matches[2];

		if ( $year < 1900 || $year > 2100 || $week < 1 || $week > 53 ) {
			return null;
		}

		return array(
			'year' => $year,
			'week' => $week,
		);
	}

	/**
	 * Format a year/week pair into the public `YYYY-Www` URL param value.
	 *
	 * @param int $year ISO year.
	 * @param int $week ISO week number.
	 * @return string Formatted `YYYY-Www` value.
	 */
	public static function format( int $year, int $week ): string {
		return sprintf( '%04d-W%02d', $year, $week );
	}

	/**
	 * The current ISO year/week, in the same shape as parse().
	 *
	 * @return array{year: int, week: int}
	 */
	public static function current(): array {
		$now = new \DateTime( 'now', new \DateTimeZone( wp_timezone_string() ) );

		return array(
			'year' => (int) $now->format( 'o' ),
			'week' => (int) $now->format( 'W' ),
		);
	}
}
