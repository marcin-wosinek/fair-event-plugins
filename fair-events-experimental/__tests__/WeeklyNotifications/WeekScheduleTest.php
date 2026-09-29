<?php
/**
 * WeekSchedule unit tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WeeklyNotifications;

use FairEventsExperimental\WeeklyNotifications\WeekSchedule;
use PHPUnit\Framework\TestCase;

/**
 * Tests send moments, covered weeks and timezone boundaries.
 */
class WeekScheduleTest extends TestCase {

	/**
	 * A moment in a timezone.
	 *
	 * @param string $datetime Local 'Y-m-d H:i'.
	 * @param string $timezone Timezone name.
	 * @return \DateTimeImmutable
	 */
	private function moment( $datetime, $timezone = 'Europe/Madrid' ) {
		return new \DateTimeImmutable( $datetime, new \DateTimeZone( $timezone ) );
	}

	/** Before this week's send time, the send is later the same week. */
	public function test_next_due_later_this_week() {
		// Monday 14 September 2026, 08:00 — the Monday 09:00 send is still ahead.
		$due = WeekSchedule::next_due( $this->moment( '2026-09-14 08:00' ), 1, '09:00' );

		$this->assertSame( '2026-09-14 09:00', $due->format( 'Y-m-d H:i' ) );
	}

	/** At or after this week's send time, the send is next week. */
	public function test_next_due_after_this_weeks_send() {
		$this->assertSame( '2026-09-21 09:00', WeekSchedule::next_due( $this->moment( '2026-09-14 09:00' ), 1, '09:00' )->format( 'Y-m-d H:i' ) );
		$this->assertSame( '2026-09-21 09:00', WeekSchedule::next_due( $this->moment( '2026-09-16 12:00' ), 1, '09:00' )->format( 'Y-m-d H:i' ) );
	}

	/** Sunday sends are the last day of the ISO week. */
	public function test_next_due_on_sunday() {
		$due = WeekSchedule::next_due( $this->moment( '2026-09-14 10:00' ), 7, '18:30' );

		$this->assertSame( '2026-09-20 18:30', $due->format( 'Y-m-d H:i' ) );
	}

	/** The send time is local wall-clock time on both sides of a DST change. */
	public function test_next_due_keeps_local_time_across_daylight_saving_change() {
		// Europe/Madrid leaves summer time on Sunday 25 October 2026.
		$before = WeekSchedule::next_due( $this->moment( '2026-10-19 08:00' ), 1, '09:00' );
		$after  = WeekSchedule::next_due( $before, 1, '09:00' );

		$this->assertSame( '2026-10-19 09:00 +02:00', $before->format( 'Y-m-d H:i P' ) );
		$this->assertSame( '2026-10-26 09:00 +01:00', $after->format( 'Y-m-d H:i P' ) );
		// The week between them is an hour longer than 7 × 24 hours.
		$this->assertSame( 7 * 24 + 1, intdiv( $after->getTimestamp() - $before->getTimestamp(), 3600 ) );
	}

	/** A send time skipped by the spring change still falls on the configured day. */
	public function test_next_due_on_a_skipped_local_time() {
		// 02:30 does not exist in Madrid on Sunday 29 March 2026.
		$due = WeekSchedule::next_due( $this->moment( '2026-03-23 10:00' ), 7, '02:30' );

		$this->assertSame( '2026-03-29', $due->format( 'Y-m-d' ) );
	}

	/** The week is chosen in the site timezone, not UTC. */
	public function test_next_due_uses_the_site_timezone_date() {
		// 23:30 on Sunday in Los Angeles is already Monday in UTC.
		$due  = WeekSchedule::next_due( $this->moment( '2026-09-13 20:00', 'America/Los_Angeles' ), 7, '23:30' );
		$week = WeekSchedule::target_week( $due, 'current', 1 );

		$this->assertSame( '2026-09-13 23:30', $due->format( 'Y-m-d H:i' ) );
		$this->assertSame( '2026-09-07', $week['start'] );
	}

	/** The current week is the configured week containing the send date. */
	public function test_target_week_current_with_monday_start() {
		$week = WeekSchedule::target_week( $this->moment( '2026-09-16 09:00' ), 'current', 1 );

		$this->assertSame(
			array(
				'start' => '2026-09-14',
				'end'   => '2026-09-20',
			),
			$week
		);
	}

	/** A Sunday send for the next week covers the following Monday to Sunday. */
	public function test_target_week_next_from_sunday() {
		$week = WeekSchedule::target_week( $this->moment( '2026-09-20 18:00' ), 'next', 1 );

		$this->assertSame( '2026-09-21', $week['start'] );
		$this->assertSame( '2026-09-27', $week['end'] );
	}

	/** Sunday-start sites cover Sunday to Saturday. */
	public function test_target_week_with_sunday_start() {
		$this->assertSame( '2026-09-20', WeekSchedule::target_week( $this->moment( '2026-09-20 09:00' ), 'current', 0 )['start'] );
		$this->assertSame( '2026-09-13', WeekSchedule::target_week( $this->moment( '2026-09-19 09:00' ), 'current', 0 )['start'] );
	}

	/** Weeks spanning a year end keep both years. */
	public function test_target_week_across_year_end() {
		$week = WeekSchedule::target_week( $this->moment( '2026-12-28 09:00' ), 'next', 1 );

		$this->assertSame(
			array(
				'start' => '2027-01-04',
				'end'   => '2027-01-10',
			),
			$week
		);
	}

	/** A delayed run keeps the week fixed when it was scheduled. */
	public function test_delayed_run_keeps_the_scheduled_week() {
		$scheduled = WeekSchedule::target_week( $this->moment( '2026-09-14 09:00' ), 'current', 1 );
		$late      = $this->moment( '2026-09-20 23:00' );

		$this->assertSame( '2026-09-14', $scheduled['start'] );
		$this->assertFalse( WeekSchedule::has_ended( $scheduled, $late ) );
		$this->assertTrue( WeekSchedule::has_ended( $scheduled, $this->moment( '2026-09-21 00:05' ) ) );
	}

	/** Week keys from cron arguments are validated. */
	public function test_week_from_start_rejects_invalid_dates() {
		$this->assertNull( WeekSchedule::week_from_start( '2026-02-30' ) );
		$this->assertNull( WeekSchedule::week_from_start( 'next week' ) );
		$this->assertSame( '2026-03-01', WeekSchedule::week_from_start( '2026-02-23' )['end'] );
	}
}
