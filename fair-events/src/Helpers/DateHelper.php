<?php
/**
 * Date Helper for timezone-safe date operations
 *
 * All event dates in the database are stored as naive 'Y-m-d H:i:s' strings
 * representing the WordPress site timezone (Settings > General > Timezone).
 * This helper provides correct conversions at import/export boundaries.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * DateHelper class for timezone-safe date operations
 */
class DateHelper {

	/**
	 * Convert a site-local naive datetime to a Unix timestamp.
	 *
	 * @param string $datetime Naive 'Y-m-d H:i:s' in site-local time.
	 * @return int|false Unix timestamp, or false on failure.
	 */
	public static function local_to_timestamp( $datetime ) {
		$tz = wp_timezone();
		$dt = date_create( $datetime, $tz );

		if ( false === $dt ) {
			return false;
		}

		return $dt->getTimestamp();
	}

	/**
	 * Convert a site-local naive datetime to an ISO 8601 UTC string.
	 *
	 * @param string $datetime Naive 'Y-m-d H:i:s' in site-local time.
	 * @return string ISO 8601 UTC string (e.g. '2025-06-15T17:30:00+00:00'), or empty string on failure.
	 */
	public static function local_to_iso8601( $datetime ) {
		$ts = self::local_to_timestamp( $datetime );

		if ( false === $ts ) {
			return '';
		}

		return gmdate( 'c', $ts );
	}

	/**
	 * Convert a site-local naive datetime to an iCal UTC string.
	 *
	 * @param string $datetime Naive 'Y-m-d H:i:s' in site-local time.
	 * @return string iCal UTC string (e.g. '20250615T173000Z'), or empty string on failure.
	 */
	public static function local_to_ical_utc( $datetime ) {
		$ts = self::local_to_timestamp( $datetime );

		if ( false === $ts ) {
			return '';
		}

		return gmdate( 'Ymd\THis\Z', $ts );
	}

	/**
	 * Convert an ISO 8601 string (any timezone) to site-local 'Y-m-d H:i:s'.
	 *
	 * @param string $iso8601 ISO 8601 datetime string (e.g. '2025-06-15T13:00:00-04:00').
	 * @return string|null Site-local 'Y-m-d H:i:s', or null on failure.
	 */
	public static function iso8601_to_local( $iso8601 ) {
		try {
			$dt = new \DateTime( $iso8601 );
		} catch ( \Exception $e ) {
			return null;
		}

		$dt->setTimezone( wp_timezone() );

		return $dt->format( 'Y-m-d H:i:s' );
	}

	/**
	 * Convert a timezone-aware DateTime object to site-local 'Y-m-d H:i:s'.
	 *
	 * @param \DateTimeInterface $datetime Timezone-aware DateTime object.
	 * @return string Site-local 'Y-m-d H:i:s'.
	 */
	public static function datetime_to_local( $datetime ) {
		$dt = clone $datetime;

		if ( $dt instanceof \DateTime ) {
			$dt->setTimezone( wp_timezone() );
		}

		return $dt->format( 'Y-m-d H:i:s' );
	}

	/**
	 * Extract the date part from a site-local naive datetime.
	 *
	 * Since stored datetimes ARE site-local, this is a simple substring — no tz math needed.
	 *
	 * @param string $datetime Naive 'Y-m-d H:i:s' in site-local time.
	 * @return string 'Y-m-d' date string.
	 */
	public static function local_date( $datetime ) {
		return substr( $datetime, 0, 10 );
	}

	/**
	 * Extract the time part (H:i) from a site-local naive datetime.
	 *
	 * Since stored datetimes ARE site-local, this is a simple substring — no tz math needed.
	 *
	 * @param string $datetime Naive 'Y-m-d H:i:s' in site-local time.
	 * @return string 'H:i' time string.
	 */
	public static function local_time( $datetime ) {
		return substr( $datetime, 11, 5 );
	}

	/**
	 * Extract the time part (H:i:s) from a site-local naive datetime.
	 *
	 * @param string $datetime Naive 'Y-m-d H:i:s' in site-local time.
	 * @return string 'H:i:s' time string.
	 */
	public static function local_time_full( $datetime ) {
		return substr( $datetime, 11, 8 );
	}

	/**
	 * Advance a 'Y-m-d' date by one day.
	 *
	 * Pure date arithmetic — no timezone concerns.
	 *
	 * @param string $date 'Y-m-d' date string.
	 * @return string Next day as 'Y-m-d'.
	 */
	public static function next_date( $date ) {
		return gmdate( 'Y-m-d', strtotime( $date . ' +1 day' ) );
	}
}
