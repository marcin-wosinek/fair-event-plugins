<?php
/**
 * Decide whether an event session has ended.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * Stored datetimes are naive site-local wall-clock values (see DateHelper),
 * so every boundary is built in wp_timezone() with calendar arithmetic —
 * "midnight after a date" stays midnight across daylight-saving changes
 * instead of drifting by an hour as a fixed 24-hour offset would.
 *
 * Rules:
 *  - Timed session with an end: ended once now reaches the end.
 *  - Timed session without an end: ended at midnight after its start date,
 *    so it isn't reported as ended the moment it begins.
 *  - All-day session: ended at midnight after its inclusive final date
 *    (the end date, or the start date when there is no end).
 */
class SessionStatus {

	/**
	 * The moment a session ends, in the site timezone.
	 *
	 * @param string|null $start_datetime Naive 'Y-m-d H:i:s' start in site-local time.
	 * @param string|null $end_datetime   Naive 'Y-m-d H:i:s' end in site-local time, or empty.
	 * @param bool        $all_day        Whether the session is all-day.
	 * @return \DateTimeImmutable|null End boundary, or null when the start is missing or invalid.
	 */
	public static function end_boundary( $start_datetime, $end_datetime, $all_day ) {
		if ( empty( $start_datetime ) ) {
			return null;
		}

		$timezone = wp_timezone();

		try {
			if ( ! $all_day && ! empty( $end_datetime ) ) {
				return new \DateTimeImmutable( $end_datetime, $timezone );
			}

			// All-day stores an inclusive end date; a timed session without an
			// end lasts until its own day is over.
			$last_date = DateHelper::local_date( ( $all_day && ! empty( $end_datetime ) ) ? $end_datetime : $start_datetime );

			return ( new \DateTimeImmutable( $last_date . ' 00:00:00', $timezone ) )->modify( '+1 day' );
		} catch ( \Exception $e ) {
			return null;
		}
	}

	/**
	 * Whether a session has ended.
	 *
	 * @param string|null             $start_datetime Naive 'Y-m-d H:i:s' start in site-local time.
	 * @param string|null             $end_datetime   Naive 'Y-m-d H:i:s' end in site-local time, or empty.
	 * @param bool                    $all_day        Whether the session is all-day.
	 * @param \DateTimeInterface|null $now            Current time; defaults to now.
	 * @return bool True once the end boundary has been reached.
	 */
	public static function has_ended( $start_datetime, $end_datetime, $all_day, $now = null ) {
		$boundary = self::end_boundary( $start_datetime, $end_datetime, $all_day );

		if ( null === $boundary ) {
			return false;
		}

		$now = $now ?? new \DateTimeImmutable( 'now', wp_timezone() );

		return $now->getTimestamp() >= $boundary->getTimestamp();
	}
}
