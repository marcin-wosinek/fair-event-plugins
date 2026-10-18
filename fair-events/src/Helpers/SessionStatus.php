<?php
/**
 * Decide whether an event session has ended.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * Sessions are described by their canonical timing (see EventTiming):
 * site-local dates with independently optional times. Every boundary is
 * built in wp_timezone() with calendar arithmetic — "midnight after a date"
 * stays midnight across daylight-saving changes instead of drifting by an
 * hour as a fixed 24-hour offset would.
 *
 * Rules:
 *  - Timed session with an end time: ended once now reaches its end.
 *  - Session without an end time, and all-day sessions: ended at midnight
 *    after the end date. This is a filtering boundary, never an event
 *    time.
 *
 * The same rules decide date filtering in SQL (EventTimingSql).
 */
class SessionStatus {

	/**
	 * The moment a session ends, in the site timezone.
	 *
	 * @param array $timing Canonical timing.
	 * @return \DateTimeImmutable|null End boundary, or null for an undated session.
	 */
	public static function end_boundary( array $timing ) {
		$timing = array_merge( EventTiming::undated(), $timing );

		if ( empty( $timing['start_date'] ) ) {
			return null;
		}

		$timezone = wp_timezone();
		$end_date = $timing['end_date'] ?? $timing['start_date'];

		try {
			if ( ! $timing['all_day'] && null !== $timing['end_time'] ) {
				return new \DateTimeImmutable( $end_date . ' ' . $timing['end_time'], $timezone );
			}

			return ( new \DateTimeImmutable( $end_date . ' 00:00:00', $timezone ) )->modify( '+1 day' );
		} catch ( \Exception $e ) {
			return null;
		}
	}

	/**
	 * Whether a session has ended.
	 *
	 * @param array                   $timing Canonical timing.
	 * @param \DateTimeInterface|null $now    Current time; defaults to now.
	 * @return bool True once the end boundary has been reached.
	 */
	public static function has_ended( array $timing, $now = null ) {
		$boundary = self::end_boundary( $timing );

		if ( null === $boundary ) {
			return false;
		}

		$now = $now ?? new \DateTimeImmutable( 'now', wp_timezone() );

		return $now->getTimestamp() >= $boundary->getTimestamp();
	}

	/**
	 * Whether a session is upcoming, as EventTimingSql::upcoming() decides
	 * it: a fully timed or all-day session until it starts, a timed session
	 * missing a time until it has ended.
	 *
	 * @param array       $timing Canonical timing.
	 * @param string|null $now    Site-local 'Y-m-d H:i:s'; defaults to now.
	 * @return bool True when upcoming.
	 */
	public static function is_upcoming( array $timing, $now = null ) {
		$timing = array_merge( EventTiming::undated(), $timing );

		if ( empty( $timing['start_date'] ) ) {
			return false;
		}

		$now   = $now ?? current_time( 'mysql' );
		$start = $timing['start_date'] . ' ' . ( $timing['start_time'] ?? '00:00:00' );

		if ( $start >= $now ) {
			return true;
		}

		if ( $timing['all_day'] || ( null !== $timing['start_time'] && null !== $timing['end_time'] ) ) {
			return false;
		}

		$end = ( $timing['end_date'] ?? $timing['start_date'] ) . ' ' . ( $timing['end_time'] ?? '23:59:59' );

		return $end >= $now;
	}
}
