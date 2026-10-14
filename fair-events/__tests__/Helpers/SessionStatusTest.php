<?php
/**
 * Tests for SessionStatus.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\SessionStatus;

/**
 * Ended-session boundaries in the site timezone (Europe/Madrid), including
 * both daylight-saving transitions, overnight sessions and multi-day
 * all-day sessions.
 */
class SessionStatusTest extends TestCase {

	/**
	 * Run every case in a timezone with daylight saving.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';
	}

	/**
	 * Restore the default test timezone.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );
	}

	/**
	 * Build an instant from an ISO 8601 string.
	 *
	 * @param string $iso ISO 8601 datetime with offset.
	 * @return \DateTimeImmutable
	 */
	private function instant( string $iso ): \DateTimeImmutable {
		return new \DateTimeImmutable( $iso );
	}

	/**
	 * A timed session with an end has ended exactly at its end.
	 *
	 * @return void
	 */
	public function test_timed_session_ends_exactly_at_its_end() {
		$start = '2026-07-14 19:00:00';
		$end   = '2026-07-14 20:30:00';

		$this->assertFalse( SessionStatus::has_ended( $start, $end, false, $this->instant( '2026-07-14T20:29:59+02:00' ) ) );
		$this->assertTrue( SessionStatus::has_ended( $start, $end, false, $this->instant( '2026-07-14T20:30:00+02:00' ) ) );
	}

	/**
	 * An ongoing session (started, not yet ended) is not ended.
	 *
	 * @return void
	 */
	public function test_ongoing_session_is_not_ended() {
		$this->assertFalse( SessionStatus::has_ended( '2026-07-14 19:00:00', '2026-07-14 20:30:00', false, $this->instant( '2026-07-14T19:30:00+02:00' ) ) );
	}

	/**
	 * An overnight session ends the next morning, not at midnight.
	 *
	 * @return void
	 */
	public function test_overnight_session_ends_next_morning() {
		$start = '2026-07-14 22:00:00';
		$end   = '2026-07-15 03:00:00';

		$this->assertFalse( SessionStatus::has_ended( $start, $end, false, $this->instant( '2026-07-15T01:00:00+02:00' ) ) );
		$this->assertTrue( SessionStatus::has_ended( $start, $end, false, $this->instant( '2026-07-15T03:00:00+02:00' ) ) );
	}

	/**
	 * A timed session without an end lasts until midnight after its start
	 * date — not ended at its start time.
	 *
	 * @return void
	 */
	public function test_timed_session_without_end_lasts_until_midnight() {
		$start = '2026-07-14 19:00:00';

		$this->assertFalse( SessionStatus::has_ended( $start, null, false, $this->instant( '2026-07-14T19:00:00+02:00' ) ) );
		$this->assertFalse( SessionStatus::has_ended( $start, '', false, $this->instant( '2026-07-14T23:59:59+02:00' ) ) );
		$this->assertTrue( SessionStatus::has_ended( $start, null, false, $this->instant( '2026-07-15T00:00:00+02:00' ) ) );
	}

	/**
	 * A multi-day all-day session ends at midnight after its inclusive
	 * final date.
	 *
	 * @return void
	 */
	public function test_multi_day_all_day_session_ends_after_inclusive_final_date() {
		$start = '2026-07-10 00:00:00';
		$end   = '2026-07-12 00:00:00';

		$this->assertFalse( SessionStatus::has_ended( $start, $end, true, $this->instant( '2026-07-12T23:59:59+02:00' ) ) );
		$this->assertTrue( SessionStatus::has_ended( $start, $end, true, $this->instant( '2026-07-13T00:00:00+02:00' ) ) );
	}

	/**
	 * A single all-day session without an end ends after its start date.
	 *
	 * @return void
	 */
	public function test_all_day_session_without_end_ends_after_start_date() {
		$this->assertFalse( SessionStatus::has_ended( '2026-07-10 00:00:00', null, true, $this->instant( '2026-07-10T12:00:00+02:00' ) ) );
		$this->assertTrue( SessionStatus::has_ended( '2026-07-10 00:00:00', null, true, $this->instant( '2026-07-11T00:00:00+02:00' ) ) );
	}

	/**
	 * Midnight boundaries follow local calendar days across the spring
	 * transition (29 March 2026, 02:00 CET → 03:00 CEST): the 23-hour day
	 * ends at 22:00 UTC, not 23:00 UTC.
	 *
	 * @return void
	 */
	public function test_midnight_boundary_across_spring_dst_change() {
		$boundary = SessionStatus::end_boundary( '2026-03-29 10:00:00', null, false );

		$this->assertSame( '2026-03-30T00:00:00+02:00', $boundary->format( 'c' ) );
		$this->assertFalse( SessionStatus::has_ended( '2026-03-29 10:00:00', null, false, $this->instant( '2026-03-29T21:59:59Z' ) ) );
		$this->assertTrue( SessionStatus::has_ended( '2026-03-29 10:00:00', null, false, $this->instant( '2026-03-29T22:00:00Z' ) ) );
	}

	/**
	 * Midnight boundaries follow local calendar days across the autumn
	 * transition (25 October 2026, 03:00 CEST → 02:00 CET): the 25-hour all-day
	 * session ends at 23:00 UTC.
	 *
	 * @return void
	 */
	public function test_midnight_boundary_across_autumn_dst_change() {
		$boundary = SessionStatus::end_boundary( '2026-10-25 00:00:00', '2026-10-25 00:00:00', true );

		$this->assertSame( '2026-10-26T00:00:00+01:00', $boundary->format( 'c' ) );
		$this->assertFalse( SessionStatus::has_ended( '2026-10-25 00:00:00', '2026-10-25 00:00:00', true, $this->instant( '2026-10-25T22:59:59Z' ) ) );
		$this->assertTrue( SessionStatus::has_ended( '2026-10-25 00:00:00', '2026-10-25 00:00:00', true, $this->instant( '2026-10-25T23:00:00Z' ) ) );
	}

	/**
	 * A timed end inside the repeated autumn hour is read as site-local wall
	 * clock time, like every stored datetime.
	 *
	 * @return void
	 */
	public function test_timed_end_on_autumn_dst_day_uses_site_local_time() {
		$boundary = SessionStatus::end_boundary( '2026-10-25 10:00:00', '2026-10-25 12:00:00', false );

		$this->assertSame( '2026-10-25T12:00:00+01:00', $boundary->format( 'c' ) );
	}

	/**
	 * A session without a start date can't be classified and is never
	 * reported as ended.
	 *
	 * @return void
	 */
	public function test_missing_start_is_not_ended() {
		$this->assertNull( SessionStatus::end_boundary( null, null, false ) );
		$this->assertFalse( SessionStatus::has_ended( '', null, false ) );
	}
}
