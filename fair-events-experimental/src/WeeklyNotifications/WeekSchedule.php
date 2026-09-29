<?php
/**
 * Weekly notification schedule arithmetic.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WeeklyNotifications;

defined( 'WPINC' ) || die;

/**
 * Computes send moments and the calendar week each send covers.
 *
 * Every moment is a DateTimeImmutable in the site timezone, so the configured
 * weekday and time are wall-clock values that follow daylight-saving changes.
 * The covered week is fixed from the scheduled moment, never from the time a
 * delayed cron run happens to execute.
 */
class WeekSchedule {

	/**
	 * The first configured send moment strictly after a moment.
	 *
	 * @param \DateTimeImmutable $after       Reference moment, in the site timezone.
	 * @param int                $day_of_week ISO weekday, Monday (1) to Sunday (7).
	 * @param string             $time_of_day 'HH:MM' in the site timezone.
	 * @return \DateTimeImmutable
	 */
	public static function next_due( \DateTimeImmutable $after, $day_of_week, $time_of_day ) {
		list( $hour, $minute ) = array_map( 'intval', explode( ':', $time_of_day ) );

		$due = $after
			->setISODate( (int) $after->format( 'o' ), (int) $after->format( 'W' ), (int) $day_of_week )
			->setTime( $hour, $minute );

		if ( $due <= $after ) {
			// Re-apply the wall-clock time after moving a week, so a
			// daylight-saving change in between keeps the configured hour.
			$due = $due->modify( '+7 days' )->setTime( $hour, $minute );
		}

		return $due;
	}

	/**
	 * The calendar week a send at a given moment covers.
	 *
	 * @param \DateTimeImmutable $due           Scheduled send moment, in the site timezone.
	 * @param string             $week_scope    'current' or 'next'.
	 * @param int                $start_of_week First weekday, from Sunday (0) to Saturday (6).
	 * @return array{start: string, end: string} Site-local 'Y-m-d' boundaries.
	 */
	public static function target_week( \DateTimeImmutable $due, $week_scope, $start_of_week ) {
		$day       = new \DateTimeImmutable( $due->format( 'Y-m-d' ), new \DateTimeZone( 'UTC' ) );
		$days_back = ( (int) $day->format( 'w' ) - (int) $start_of_week + 7 ) % 7;
		$start     = $day->modify( '-' . $days_back . ' days' );
		if ( 'next' === $week_scope ) {
			$start = $start->modify( '+7 days' );
		}

		return self::week_from_start( $start->format( 'Y-m-d' ) );
	}

	/**
	 * Week boundaries from its first day.
	 *
	 * @param string $start_date 'Y-m-d' first day.
	 * @return array{start: string, end: string}|null Boundaries, or null for an invalid date.
	 */
	public static function week_from_start( $start_date ) {
		$start = \DateTimeImmutable::createFromFormat( '!Y-m-d', (string) $start_date, new \DateTimeZone( 'UTC' ) );
		if ( ! $start || $start->format( 'Y-m-d' ) !== $start_date ) {
			return null;
		}

		return array(
			'start' => $start_date,
			'end'   => $start->modify( '+6 days' )->format( 'Y-m-d' ),
		);
	}

	/**
	 * Whether a covered week has already ended at a moment.
	 *
	 * @param array{start: string, end: string} $week Week boundaries.
	 * @param \DateTimeImmutable                $now  Current moment, in the site timezone.
	 * @return bool
	 */
	public static function has_ended( array $week, \DateTimeImmutable $now ) {
		return $now->format( 'Y-m-d' ) > $week['end'];
	}
}
