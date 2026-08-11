<?php
/**
 * Parse and format the public `calendar_month`/`calendar_year` URL params.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * The events-calendar block reads which month to display from
 * `?calendar_month=` + `?calendar_year=` (falling back to block attributes,
 * then "now"). This helper is the single place that validates that pair, so
 * the block's own render and the dated-view canonical-URL logic share one
 * implementation instead of two regexes drifting apart.
 */
class CalendarMonthParam {

	/**
	 * Validate a raw month/year pair.
	 *
	 * @param string $month_raw Raw month value (expected `mm`, 01-12).
	 * @param string $year_raw  Raw year value (expected `YYYY`, 1900-2100).
	 * @return array{month: string, year: string}|null The validated pair, or
	 *                                                  null if either value
	 *                                                  fails validation.
	 */
	public static function parse( string $month_raw, string $year_raw ): ?array {
		if ( ! preg_match( '/^(0[1-9]|1[0-2])$/', $month_raw ) ) {
			return null;
		}

		if ( ! preg_match( '/^\d{4}$/', $year_raw ) || $year_raw < 1900 || $year_raw > 2100 ) {
			return null;
		}

		return array(
			'month' => $month_raw,
			'year'  => $year_raw,
		);
	}

	/**
	 * The current month/year, in the same shape as parse().
	 *
	 * @return array{month: string, year: string}
	 */
	public static function current(): array {
		return array(
			'month' => current_time( 'm' ),
			'year'  => current_time( 'Y' ),
		);
	}
}
