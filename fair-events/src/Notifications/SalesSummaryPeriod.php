<?php
/**
 * Sales summary schedule and reporting periods.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Send moments and the period each sales summary send reports (#2306).
 *
 * Every moment is a DateTimeImmutable in the site timezone, so the delivery
 * time is a wall-clock value that follows daylight-saving changes. A send
 * reports the last completed site-local period before it: the previous
 * calendar day for a daily summary, the previous Monday-to-Sunday week for
 * a weekly one, whenever the events themselves take place.
 *
 * Each send is identified by its occurrence: the send day ('Y-m-d') for a
 * daily summary, the send's ISO week ('o-\WW') for a weekly one. The two
 * formats never coincide, so daily and weekly sends of one report never
 * share a delivery claim or a history row.
 */
class SalesSummaryPeriod {

	/**
	 * The first send moment strictly after a moment.
	 *
	 * @param array              $settings Report settings: frequency, time_of_day, day_of_week.
	 * @param \DateTimeImmutable $after    Reference moment, in the site timezone.
	 * @return \DateTimeImmutable
	 */
	public static function next_due( array $settings, \DateTimeImmutable $after ) {
		if ( SalesSummarySettings::WEEKLY === $settings['frequency'] ) {
			return WeekSchedule::next_due( $after, (int) $settings['day_of_week'], $settings['time_of_day'] );
		}

		list( $hour, $minute ) = array_map( 'intval', explode( ':', $settings['time_of_day'] ) );

		$due = $after->setTime( $hour, $minute );
		if ( $due <= $after ) {
			// Re-apply the wall-clock time after moving a day, so a
			// daylight-saving change in between keeps the configured hour.
			$due = $due->modify( '+1 day' )->setTime( $hour, $minute );
		}
		return $due;
	}

	/**
	 * The occurrence a send moment belongs to.
	 *
	 * @param string             $frequency Daily or weekly.
	 * @param \DateTimeImmutable $moment    Send moment, in the site timezone.
	 * @return string
	 */
	public static function occurrence( $frequency, \DateTimeImmutable $moment ) {
		return SalesSummarySettings::WEEKLY === $frequency
			? BulkEmailDispatcher::iso_week( $moment )
			: $moment->format( 'Y-m-d' );
	}

	/**
	 * The period an occurrence reports.
	 *
	 * @param string $frequency  Daily or weekly.
	 * @param string $occurrence Occurrence from {@see self::occurrence()}.
	 * @return array{start: string, end: string}|null Site-local 'Y-m-d'
	 *     boundaries, both inclusive; null for an occurrence of another format.
	 */
	public static function period( $frequency, $occurrence ) {
		$utc = new \DateTimeZone( 'UTC' );

		if ( SalesSummarySettings::WEEKLY === $frequency ) {
			$monday = BulkEmailDispatcher::week_start( $occurrence );
			if ( null === $monday ) {
				return null;
			}
			$start = new \DateTimeImmutable( $monday, $utc );
			return array(
				'start' => $start->modify( '-7 days' )->format( 'Y-m-d' ),
				'end'   => $start->modify( '-1 day' )->format( 'Y-m-d' ),
			);
		}

		if ( SalesSummarySettings::DAILY !== $frequency ) {
			return null;
		}
		$day = \DateTimeImmutable::createFromFormat( '!Y-m-d', (string) $occurrence, $utc );
		if ( ! $day || $day->format( 'Y-m-d' ) !== $occurrence ) {
			return null;
		}
		$previous = $day->modify( '-1 day' )->format( 'Y-m-d' );
		return array(
			'start' => $previous,
			'end'   => $previous,
		);
	}

	/**
	 * The period a send at a moment reports.
	 *
	 * @param string             $frequency Daily or weekly.
	 * @param \DateTimeImmutable $moment    Send moment, in the site timezone.
	 * @return array{start: string, end: string}
	 */
	public static function period_at( $frequency, \DateTimeImmutable $moment ) {
		return self::period( $frequency, self::occurrence( $frequency, $moment ) );
	}

	/**
	 * Site-local wall-clock bounds of a period for comparing stored
	 * site-local times: the start is included, the end excluded.
	 *
	 * Comparing wall-clock strings keeps a period whole across a
	 * daylight-saving change: a day is every time stamped with its date.
	 *
	 * @param array{start: string, end: string} $period Period.
	 * @return array{0: string, 1: string} 'Y-m-d H:i:s' start and exclusive end.
	 */
	public static function bounds( array $period ) {
		$end = new \DateTimeImmutable( $period['end'], new \DateTimeZone( 'UTC' ) );
		return array( $period['start'] . ' 00:00:00', $end->modify( '+1 day' )->format( 'Y-m-d' ) . ' 00:00:00' );
	}
}
