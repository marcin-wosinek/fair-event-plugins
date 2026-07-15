<?php
/**
 * WeeklyDigestHooks due/idempotency tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Hooks;

use PHPUnit\Framework\TestCase;
use FairAudience\Hooks\WeeklyDigestHooks;
use ReflectionMethod;
use DateTime;
use DateTimeZone;

require_once __DIR__ . '/fixtures-weekly-events-provider-stub.php';

/**
 * Validates the cron tick's week-boundary due-check and the at-most-once
 * `last_sent_week` idempotency guard. The full render/send path is covered
 * by the API integration tests, not here.
 */
class WeeklyDigestHooksTest extends TestCase {

	/**
	 * Reset the fake options store before each test.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/**
	 * Invoke the private static is_due() via reflection.
	 *
	 * @param DateTime $now         Current time in site timezone.
	 * @param int      $day_of_week ISO day of week (1=Monday..7=Sunday).
	 * @param string   $time_of_day 'HH:MM'.
	 * @return bool
	 */
	private function is_due( DateTime $now, $day_of_week, $time_of_day ) {
		$method = new ReflectionMethod( WeeklyDigestHooks::class, 'is_due' );
		return $method->invoke( null, $now, $day_of_week, $time_of_day );
	}

	/**
	 * Not yet due: same day, one minute before the configured time.
	 */
	public function test_is_due_false_before_configured_time_on_the_day() {
		// 2026-07-06 is a Monday.
		$now = new DateTime( '2026-07-06 07:59:00', new DateTimeZone( 'UTC' ) );
		$this->assertFalse( $this->is_due( $now, 1, '08:00' ) );
	}

	/**
	 * Due: exactly at the configured day/time.
	 */
	public function test_is_due_true_at_configured_time_on_the_day() {
		$now = new DateTime( '2026-07-06 08:00:00', new DateTimeZone( 'UTC' ) );
		$this->assertTrue( $this->is_due( $now, 1, '08:00' ) );
	}

	/**
	 * Due: any time after the configured day/time.
	 */
	public function test_is_due_true_after_configured_time_on_the_day() {
		$now = new DateTime( '2026-07-06 12:00:00', new DateTimeZone( 'UTC' ) );
		$this->assertTrue( $this->is_due( $now, 1, '08:00' ) );
	}

	/**
	 * Not due yet: configured day hasn't arrived this week.
	 */
	public function test_is_due_false_on_an_earlier_day_of_the_same_week() {
		// Configured for Wednesday (3); now is Monday.
		$now = new DateTime( '2026-07-06 23:00:00', new DateTimeZone( 'UTC' ) );
		$this->assertFalse( $this->is_due( $now, 3, '08:00' ) );
	}

	/**
	 * A disabled digest never touches the idempotency-guard options.
	 */
	public function test_run_due_does_nothing_when_disabled() {
		$GLOBALS['_fair_test_options']['fair_audience_weekly_digest'] = array(
			'enabled'     => false,
			'source_slug' => 'demo',
			'day_of_week' => 1,
			'time_of_day' => '00:00',
			'week_scope'  => 'current',
			'skip_empty'  => true,
		);

		WeeklyDigestHooks::run_due();

		$this->assertArrayNotHasKey( 'fair_audience_weekly_digest_last_sent_week', $GLOBALS['_fair_test_options'] );
		$this->assertArrayNotHasKey( 'fair_audience_weekly_digest_last_run_result', $GLOBALS['_fair_test_options'] );
	}

	/**
	 * An enabled digest with no source configured never dispatches.
	 */
	public function test_run_due_does_nothing_without_a_configured_source() {
		$GLOBALS['_fair_test_options']['fair_audience_weekly_digest'] = array(
			'enabled'     => true,
			'source_slug' => '',
			'day_of_week' => 1,
			'time_of_day' => '00:00',
			'week_scope'  => 'current',
			'skip_empty'  => true,
		);

		WeeklyDigestHooks::run_due();

		$this->assertArrayNotHasKey( 'fair_audience_weekly_digest_last_sent_week', $GLOBALS['_fair_test_options'] );
	}

	/**
	 * The last_sent_week guard wins even when the day/time check says "due".
	 */
	public function test_run_due_skips_a_week_already_marked_sent() {
		$now              = new DateTime( 'now', wp_timezone() );
		$current_iso_week = $now->format( 'o' ) . '-W' . $now->format( 'W' );

		// Configure it as due (day/time comfortably in the past) but already
		// marked sent for the current ISO week — the guard must win even
		// though the day/time check would otherwise say "due".
		$GLOBALS['_fair_test_options']['fair_audience_weekly_digest']                = array(
			'enabled'     => true,
			'source_slug' => 'demo',
			'day_of_week' => (int) $now->format( 'N' ),
			'time_of_day' => '00:00',
			'week_scope'  => 'current',
			'skip_empty'  => true,
		);
		$GLOBALS['_fair_test_options']['fair_audience_weekly_digest_last_sent_week'] = $current_iso_week;

		WeeklyDigestHooks::run_due();

		$this->assertArrayNotHasKey( 'fair_audience_weekly_digest_last_run_result', $GLOBALS['_fair_test_options'] );
		$this->assertSame( $current_iso_week, $GLOBALS['_fair_test_options']['fair_audience_weekly_digest_last_sent_week'] );
	}

	/**
	 * A newly-due week dispatches once, marks last_sent_week, and a second
	 * tick in the same week is a no-op (the idempotency guard, not just
	 * is_due, is what stops the resend).
	 */
	public function test_run_due_dispatches_once_for_a_new_due_week() {
		$now = new DateTime( 'now', wp_timezone() );
		// The exact current minute so "now >= due" holds regardless of the
		// instant the test happens to run.
		$time_of_day      = $now->format( 'H:i' );
		$current_iso_week = $now->format( 'o' ) . '-W' . $now->format( 'W' );

		$GLOBALS['_fair_test_options']['fair_audience_weekly_digest'] = array(
			'enabled'     => true,
			'source_slug' => 'demo',
			'day_of_week' => (int) $now->format( 'N' ),
			'time_of_day' => $time_of_day,
			'week_scope'  => 'current',
			'skip_empty'  => true,
		);

		WeeklyDigestHooks::run_due();

		$this->assertSame( $current_iso_week, $GLOBALS['_fair_test_options']['fair_audience_weekly_digest_last_sent_week'] );
		$this->assertSame( 'skipped', $GLOBALS['_fair_test_options']['fair_audience_weekly_digest_last_run_result']['status'] );

		// A second tick in the same week must not dispatch again — record_result
		// is only written on a dispatch, so clearing it and re-running proves
		// the guard (not just is_due) is what stops the resend.
		unset( $GLOBALS['_fair_test_options']['fair_audience_weekly_digest_last_run_result'] );
		WeeklyDigestHooks::run_due();
		$this->assertArrayNotHasKey( 'fair_audience_weekly_digest_last_run_result', $GLOBALS['_fair_test_options'] );
	}

	/**
	 * Due_moment() resolves to the configured day/time within now's ISO week.
	 */
	public function test_due_moment_resolves_configured_slot_in_current_week() {
		// 2026-07-06 is the Monday of ISO week 2026-W28.
		$now = new DateTime( '2026-07-08 12:00:00', new DateTimeZone( 'UTC' ) );
		$due = WeeklyDigestHooks::due_moment( $now, 1, '08:00' );

		$this->assertSame( '2026-07-06 08:00:00', $due->format( 'Y-m-d H:i:s' ) );
	}

	/**
	 * Iso_week() formats as "<ISO year>-W<ISO week>", zero-padded.
	 */
	public function test_iso_week_formats_year_and_week() {
		$now = new DateTime( '2026-07-08 12:00:00', new DateTimeZone( 'UTC' ) );
		$this->assertSame( '2026-W28', WeeklyDigestHooks::iso_week( $now ) );
	}
}
