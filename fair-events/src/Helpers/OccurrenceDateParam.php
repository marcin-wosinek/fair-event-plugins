<?php
/**
 * Parse and format the public `event_date` URL param.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * The public `?event_date=` URL param identifies a recurring occurrence by
 * its calendar date (`Y-m-d`), not its opaque internal id, so links stay
 * readable and survive occurrence regeneration. This helper is the single
 * place that formats a row into that param and parses it back.
 */
class OccurrenceDateParam {

	/**
	 * Format an event-date row's start date for use as the public URL param.
	 *
	 * @param EventDates $row Event date row.
	 * @return string Date in `Y-m-d` format.
	 */
	public static function format( EventDates $row ): string {
		return gmdate( 'Y-m-d', strtotime( $row->start_datetime ) );
	}

	/**
	 * Parse a URL param into a strict `Y-m-d` SQL date, or null if invalid.
	 *
	 * Round-trips through DateTime so out-of-range dates like `2026-13-40`
	 * (which PHP would otherwise silently roll over) are rejected.
	 *
	 * @param string $param Raw URL param value.
	 * @return string|null `Y-m-d` date, or null if not a valid date.
	 */
	public static function parse( string $param ): ?string {
		$date = \DateTime::createFromFormat( 'Y-m-d', $param );

		if ( ! $date || $date->format( 'Y-m-d' ) !== $param ) {
			return null;
		}

		return $date->format( 'Y-m-d' );
	}

	/**
	 * Whether a raw URL param looks like a legacy numeric event-date id.
	 *
	 * A date param always contains dashes, so an all-digits string is
	 * unambiguously the old id-based format.
	 *
	 * @param string $param Raw URL param value.
	 * @return bool True if the param is all digits.
	 */
	public static function is_legacy_id( string $param ): bool {
		return (bool) preg_match( '/^\d+$/', $param );
	}
}
