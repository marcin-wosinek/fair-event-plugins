<?php
/**
 * SalesSummaryPeriod tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\SalesSummaryPeriod;
use PHPUnit\Framework\TestCase;

/**
 * Sales summary schedule: send moments in the site timezone and the
 * previous completed day or Monday-to-Sunday week each send reports.
 */
class SalesSummaryPeriodTest extends TestCase {

	/**
	 * A moment in a timezone.
	 *
	 * @param string $time     Local time.
	 * @param string $timezone Timezone.
	 * @return \DateTimeImmutable
	 */
	private static function moment( $time, $timezone = 'Europe/Madrid' ) {
		return new \DateTimeImmutable( $time, new \DateTimeZone( $timezone ) );
	}

	/**
	 * Settings.
	 *
	 * @param string $frequency Frequency.
	 * @param string $time      Time of day.
	 * @param int    $day       Weekday.
	 * @return array
	 */
	private static function settings( $frequency, $time = '08:00', $day = 1 ) {
		return array(
			'frequency'   => $frequency,
			'time_of_day' => $time,
			'day_of_week' => $day,
		);
	}

	/** A daily send goes out today when the time is still ahead, otherwise tomorrow. */
	public function test_daily_next_due() {
		$this->assertSame( '2026-11-18 08:00', SalesSummaryPeriod::next_due( self::settings( 'daily' ), self::moment( '2026-11-18 07:59' ) )->format( 'Y-m-d H:i' ) );
		$this->assertSame( '2026-11-19 08:00', SalesSummaryPeriod::next_due( self::settings( 'daily' ), self::moment( '2026-11-18 08:00' ) )->format( 'Y-m-d H:i' ) );
	}

	/** A daily send keeps its wall-clock hour across both daylight-saving changes. */
	public function test_daily_next_due_keeps_the_hour_across_daylight_saving() {
		$spring = SalesSummaryPeriod::next_due( self::settings( 'daily', '02:30' ), self::moment( '2026-03-28 09:00' ) );
		$this->assertSame( '2026-03-29', $spring->format( 'Y-m-d' ) );

		$autumn = SalesSummaryPeriod::next_due( self::settings( 'daily' ), self::moment( '2026-10-24 09:00' ) );
		$this->assertSame( '2026-10-25 08:00 +01:00', $autumn->format( 'Y-m-d H:i P' ) );
		$this->assertSame( 24 * 3600, $autumn->getTimestamp() - self::moment( '2026-10-24 09:00' )->getTimestamp() );
	}

	/** A weekly send uses the configured weekday and time. */
	public function test_weekly_next_due() {
		$due = SalesSummaryPeriod::next_due( self::settings( 'weekly', '09:30', 3 ), self::moment( '2026-11-18 10:00' ) );
		$this->assertSame( '2026-11-25 09:30', $due->format( 'Y-m-d H:i' ) );
	}

	/** A daily send reports the previous day; a weekly one the previous Monday to Sunday. */
	public function test_periods() {
		$this->assertSame(
			array(
				'start' => '2026-11-17',
				'end'   => '2026-11-17',
			),
			SalesSummaryPeriod::period_at( 'daily', self::moment( '2026-11-18 08:00' ) )
		);
		$this->assertSame(
			array(
				'start' => '2026-11-09',
				'end'   => '2026-11-15',
			),
			SalesSummaryPeriod::period_at( 'weekly', self::moment( '2026-11-18 08:00' ) )
		);
		// Monday reports the week that just ended, not the one starting.
		$this->assertSame(
			array(
				'start' => '2026-11-09',
				'end'   => '2026-11-15',
			),
			SalesSummaryPeriod::period_at( 'weekly', self::moment( '2026-11-16 00:30' ) )
		);
	}

	/** Periods cross month and year boundaries. */
	public function test_periods_across_the_year() {
		$this->assertSame( '2025-12-31', SalesSummaryPeriod::period_at( 'daily', self::moment( '2026-01-01 08:00' ) )['start'] );
		$this->assertSame(
			array(
				'start' => '2025-12-29',
				'end'   => '2026-01-04',
			),
			SalesSummaryPeriod::period_at( 'weekly', self::moment( '2026-01-07 08:00' ) )
		);
	}

	/** Daily and weekly occurrences never coincide, so their claims and history stay apart. */
	public function test_daily_and_weekly_occurrences_differ() {
		$monday = self::moment( '2026-11-16 08:00' );
		$this->assertSame( '2026-11-16', SalesSummaryPeriod::occurrence( 'daily', $monday ) );
		$this->assertSame( '2026-W47', SalesSummaryPeriod::occurrence( 'weekly', $monday ) );
		$this->assertNull( SalesSummaryPeriod::period( 'weekly', '2026-11-16' ) );
		$this->assertNull( SalesSummaryPeriod::period( 'daily', '2026-W47' ) );
	}

	/** Bounds are wall-clock strings, so a 23- or 25-hour day stays whole. */
	public function test_bounds_cover_a_daylight_saving_day() {
		$this->assertSame(
			array( '2026-10-25 00:00:00', '2026-10-26 00:00:00' ),
			SalesSummaryPeriod::bounds(
				array(
					'start' => '2026-10-25',
					'end'   => '2026-10-25',
				)
			)
		);
		$this->assertSame(
			array( '2026-11-09 00:00:00', '2026-11-16 00:00:00' ),
			SalesSummaryPeriod::bounds(
				array(
					'start' => '2026-11-09',
					'end'   => '2026-11-15',
				)
			)
		);
	}
}
