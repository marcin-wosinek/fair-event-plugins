<?php
/**
 * TicketAvailability sale-period and ticket-type boundary tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\TicketAvailability;

/**
 * Validates the pure period-selection and enabled-state math shared by every
 * consumer of ticket availability (signup display, purchase validation,
 * pricing, event metadata). Database-backed lookups are exercised via API
 * integration tests, not here.
 */
class TicketAvailabilityTest extends TestCase {

	/**
	 * Build a sale period stub with the given boundaries.
	 *
	 * @param string $sale_start Sale start datetime.
	 * @param string $sale_end   Sale end datetime.
	 * @return object Anonymous period object exposing sale_start/sale_end.
	 */
	private function period( $sale_start, $sale_end ) {
		return (object) array(
			'sale_start' => $sale_start,
			'sale_end'   => $sale_end,
		);
	}

	/**
	 * Build a ticket type stub with the given id.
	 *
	 * @param int $id Ticket type ID.
	 * @return object Anonymous ticket type object exposing id.
	 */
	private function ticket_type( $id ) {
		return (object) array( 'id' => $id );
	}

	/**
	 * No periods configured at all.
	 */
	public function test_no_periods_returns_null() {
		$this->assertNull( TicketAvailability::pick_active_period( array(), '2026-01-15 00:00:00', false ) );
	}

	/**
	 * Period context preserves the selected period and configured count.
	 */
	public function test_period_context_returns_active_period_and_count() {
		$past   = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$active = $this->period( '2026-02-01 00:00:00', '2026-03-01 00:00:00' );

		$context = TicketAvailability::resolve_period_context_from_periods(
			array( $past, $active ),
			'2026-02-15 00:00:00',
			null
		);

		$this->assertEquals( $active, $context['active_period'] );
		$this->assertSame( 2, $context['sale_period_count'] );
	}

	/**
	 * Empty period context exposes a zero count and no active/upcoming period.
	 */
	public function test_period_context_is_empty_when_unconfigured() {
		$context = TicketAvailability::resolve_period_context_from_periods( array(), '2026-02-15 00:00:00', null );

		$this->assertNull( $context['active_period'] );
		$this->assertNull( $context['upcoming_period'] );
		$this->assertSame( 0, $context['sale_period_count'] );
	}

	/**
	 * Period context also classifies the nearest not-yet-started period as
	 * upcoming, alongside the active one.
	 */
	public function test_period_context_returns_upcoming_period() {
		$upcoming = $this->period( '2026-06-01 00:00:00', '2026-07-01 00:00:00' );

		$context = TicketAvailability::resolve_period_context_from_periods(
			array( $upcoming ),
			'2026-01-01 00:00:00',
			null
		);

		$this->assertNull( $context['active_period'] );
		$this->assertEquals( $upcoming, $context['upcoming_period'] );
	}

	/**
	 * Now falls inside a period's range.
	 */
	public function test_period_containing_now_is_active() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertSame( $period, TicketAvailability::pick_active_period( array( $period ), '2026-01-15 00:00:00', false ) );
	}

	/**
	 * The sale_end day is the first day no longer on sale.
	 */
	public function test_end_day_is_exclusive() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		// Half-open interval: sale_end itself is no longer on sale.
		$this->assertNull( TicketAvailability::pick_active_period( array( $period ), '2026-02-01 00:00:00', false ) );
	}

	/**
	 * The sale_start day is the first day on sale.
	 */
	public function test_start_day_is_inclusive() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertSame( $period, TicketAvailability::pick_active_period( array( $period ), '2026-01-01 00:00:00', false ) );
	}

	/**
	 * Without continues_pricing_period, nothing sells after the last period ends.
	 */
	public function test_after_last_period_without_continues_returns_null() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertNull( TicketAvailability::pick_active_period( array( $period ), '2026-03-01 00:00:00', false ) );
	}

	/**
	 * With continues_pricing_period, the last period keeps selling after its own end.
	 */
	public function test_after_last_period_with_continues_falls_back_to_it() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertSame( $period, TicketAvailability::pick_active_period( array( $period ), '2026-03-01 00:00:00', true ) );
	}

	/**
	 * The fallback never jumps ahead to a period that hasn't started yet.
	 */
	public function test_continues_fallback_only_applies_to_last_period_after_its_own_start() {
		$earlier = $this->period( '2026-01-01 00:00:00', '2026-01-15 00:00:00' );
		$later   = $this->period( '2026-02-01 00:00:00', '2026-02-15 00:00:00' );
		// Now is between the two periods, before the last period's own start —
		// continues_pricing_period should not jump ahead to a future period.
		$this->assertNull( TicketAvailability::pick_active_period( array( $earlier, $later ), '2026-01-20 00:00:00', true ) );
	}

	/**
	 * The fallback only ever considers the last period, never an earlier one.
	 */
	public function test_continues_fallback_ignores_non_last_period() {
		$earlier = $this->period( '2026-01-01 00:00:00', '2026-01-15 00:00:00' );
		$later   = $this->period( '2026-02-01 00:00:00', '2026-02-15 00:00:00' );
		// Now is after the earlier period's own end but the later period hasn't
		// started yet — the fallback only ever considers the last period.
		$this->assertNull( TicketAvailability::pick_active_period( array( $earlier, $later ), '2026-01-16 00:00:00', true ) );
	}

	/**
	 * No periods start in the future.
	 */
	public function test_pick_upcoming_period_no_future_period_returns_null() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertNull( TicketAvailability::pick_upcoming_period( array( $period ), '2026-03-01 00:00:00' ) );
	}

	/**
	 * A period starting in the future is picked as upcoming.
	 */
	public function test_pick_upcoming_period_picks_future_period() {
		$period = $this->period( '2026-06-01 00:00:00', '2026-07-01 00:00:00' );
		$this->assertSame( $period, TicketAvailability::pick_upcoming_period( array( $period ), '2026-01-01 00:00:00' ) );
	}

	/**
	 * Of several future periods, the earliest-starting one is picked.
	 */
	public function test_pick_upcoming_period_picks_earliest_future_period() {
		$later   = $this->period( '2026-08-01 00:00:00', '2026-09-01 00:00:00' );
		$earlier = $this->period( '2026-06-01 00:00:00', '2026-07-01 00:00:00' );
		$this->assertSame(
			$earlier,
			TicketAvailability::pick_upcoming_period( array( $later, $earlier ), '2026-01-01 00:00:00' )
		);
	}

	/**
	 * A period whose sale_start equals now has already started, so it's not
	 * "upcoming" — matches pick_active_period()'s inclusive start.
	 */
	public function test_pick_upcoming_period_start_equal_to_now_is_not_upcoming() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertNull( TicketAvailability::pick_upcoming_period( array( $period ), '2026-01-01 00:00:00' ) );
	}

	/**
	 * The last (and only) period's unset sale_end substitutes the computed
	 * default.
	 */
	public function test_resolve_periods_substitutes_unset_end_on_last_period() {
		$period   = $this->period( '2026-01-01 00:00:00', null );
		$resolved = TicketAvailability::resolve_periods( array( $period ), '2026-01-15 00:00:00', '2026-03-01 00:00:00' );
		$this->assertSame( '2026-03-01 00:00:00', $resolved[0]->sale_end );
		// The original period object is untouched — resolve_periods clones.
		$this->assertNull( $period->sale_end );
	}

	/**
	 * The first (and only) period's unset sale_start resolves to today, while
	 * today still precedes its (explicit) end.
	 */
	public function test_resolve_periods_unset_start_resolves_to_today_before_end() {
		$period   = $this->period( '', '2026-06-01 00:00:00' );
		$resolved = TicketAvailability::resolve_periods( array( $period ), '2026-01-15 09:30:00', null );
		$this->assertSame( '2026-01-15 00:00:00', $resolved[0]->sale_start );
	}

	/**
	 * Once today reaches (or passes) the period's end, an unset start no
	 * longer resolves — an expired period never reactivates via a historical
	 * "always started" sentinel.
	 */
	public function test_resolve_periods_unset_start_stays_unresolved_after_end() {
		$period   = $this->period( '', '2026-06-01 00:00:00' );
		$resolved = TicketAvailability::resolve_periods( array( $period ), '2026-06-01 00:00:00', null );
		$this->assertNull( $resolved[0]->sale_start );
	}

	/**
	 * Explicit sale_start/sale_end values are left untouched.
	 */
	public function test_resolve_periods_leaves_explicit_values_untouched() {
		$period   = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$resolved = TicketAvailability::resolve_periods( array( $period ), '2026-01-15 00:00:00', '2026-09-01 00:00:00' );
		$this->assertSame( '2026-01-01 00:00:00', $resolved[0]->sale_start );
		$this->assertSame( '2026-02-01 00:00:00', $resolved[0]->sale_end );
	}

	/**
	 * With no default end available (e.g. the event/series has no occurrences),
	 * an unset sale_end is left unset rather than substituting a bogus value —
	 * and since the end can't resolve, the unset start can't infer either.
	 */
	public function test_resolve_periods_without_default_end_leaves_end_and_start_unset() {
		$period   = $this->period( '', null );
		$resolved = TicketAvailability::resolve_periods( array( $period ), '2026-01-15 00:00:00', null );
		$this->assertNull( $resolved[0]->sale_end );
		$this->assertNull( $resolved[0]->sale_start );
	}

	/**
	 * Only the first period may infer a missing start — an interior period's
	 * unset start is left unresolved rather than silently opened up.
	 */
	public function test_resolve_periods_interior_missing_start_stays_unresolved() {
		$first    = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$interior = $this->period( '', '2026-03-01 00:00:00' );
		$last     = $this->period( '2026-03-01 00:00:00', '2026-04-01 00:00:00' );

		$resolved = TicketAvailability::resolve_periods( array( $first, $interior, $last ), '2026-02-15 00:00:00', null );

		$this->assertNull( $resolved[1]->sale_start );
	}

	/**
	 * Only the last period may infer a missing end — an interior period's
	 * unset end is left unresolved rather than substituting the series default.
	 */
	public function test_resolve_periods_interior_missing_end_stays_unresolved() {
		$first    = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$interior = $this->period( '2026-02-01 00:00:00', null );
		$last     = $this->period( '2026-03-01 00:00:00', '2026-04-01 00:00:00' );

		$resolved = TicketAvailability::resolve_periods( array( $first, $interior, $last ), '2026-02-15 00:00:00', '2026-05-01 00:00:00' );

		$this->assertNull( $resolved[1]->sale_end );
	}

	/**
	 * A multi-period sequence resolves only its first period's start and
	 * last period's end; the middle period's explicit boundaries pass through.
	 */
	public function test_resolve_periods_only_resolves_outer_boundaries() {
		$first  = $this->period( '', '2026-02-01 00:00:00' );
		$middle = $this->period( '2026-02-01 00:00:00', '2026-03-01 00:00:00' );
		$last   = $this->period( '2026-03-01 00:00:00', null );

		$resolved = TicketAvailability::resolve_periods( array( $first, $middle, $last ), '2026-01-10 00:00:00', '2026-04-01 00:00:00' );

		$this->assertSame( '2026-01-10 00:00:00', $resolved[0]->sale_start );
		$this->assertSame( '2026-02-01 00:00:00', $resolved[1]->sale_start );
		$this->assertSame( '2026-03-01 00:00:00', $resolved[1]->sale_end );
		$this->assertSame( '2026-04-01 00:00:00', $resolved[2]->sale_end );
	}

	/**
	 * Compute_default_sale_end() returns the day after the last occurrence at
	 * midnight site time, regardless of the occurrence's own time-of-day.
	 */
	public function test_compute_default_sale_end_is_day_after_at_midnight() {
		$this->assertSame(
			'2026-06-16 00:00:00',
			TicketAvailability::compute_default_sale_end( '2026-06-15 18:30:00' )
		);
	}

	/**
	 * With no occurrence to anchor to, there is no default.
	 */
	public function test_compute_default_sale_end_null_input_returns_null() {
		$this->assertNull( TicketAvailability::compute_default_sale_end( null ) );
	}

	/**
	 * End-to-end: a single period with an unset window resolves through
	 * pick_active_period() as purchasable from today up through the day
	 * after the last occurrence — never "closed" just because nothing was
	 * ever stored.
	 */
	public function test_unset_window_resolves_purchasable_through_default_end() {
		$period      = $this->period( null, null );
		$default_end = TicketAvailability::compute_default_sale_end( '2026-06-15 18:30:00' );
		$resolved    = TicketAvailability::resolve_periods( array( $period ), '2026-06-15 12:00:00', $default_end );
		$this->assertSame( $resolved[0], TicketAvailability::pick_active_period( $resolved, '2026-06-15 12:00:00', true ) );
		// The final day (day after the occurrence) is no longer on sale — half-open range.
		$resolved_next_day = TicketAvailability::resolve_periods( array( $period ), '2026-06-16 00:00:00', $default_end );
		$this->assertNull( TicketAvailability::pick_active_period( $resolved_next_day, '2026-06-16 00:00:00', false ) );
	}

	/**
	 * Pick_active_period() never selects a period with an unresolved
	 * boundary — the sentinel-free unresolved state must stay inert even if
	 * a caller forgets to filter it out first.
	 */
	public function test_pick_active_period_skips_unresolved_boundaries() {
		$unresolved_start = $this->period( null, '2026-06-01 00:00:00' );
		$unresolved_end   = $this->period( '2026-01-01 00:00:00', null );
		$this->assertNull( TicketAvailability::pick_active_period( array( $unresolved_start ), '2026-03-01 00:00:00', false ) );
		$this->assertNull( TicketAvailability::pick_active_period( array( $unresolved_end ), '2026-03-01 00:00:00', false ) );
	}

	/**
	 * The continues fallback never selects the last period when its own
	 * start is unresolved — no historical sentinel means it can't compare
	 * as "already started".
	 */
	public function test_continues_fallback_skips_unresolved_last_start() {
		$period = $this->period( null, null );
		$this->assertNull( TicketAvailability::pick_active_period( array( $period ), '2026-03-01 00:00:00', true ) );
	}

	/**
	 * Pick_upcoming_period() never selects a period with an unresolved start.
	 */
	public function test_pick_upcoming_period_skips_unresolved_start() {
		$period = $this->period( null, '2026-06-01 00:00:00' );
		$this->assertNull( TicketAvailability::pick_upcoming_period( array( $period ), '2026-01-01 00:00:00' ) );
	}

	/**
	 * Resolve the closed-sales classification the way every consumer gets it:
	 * through the period context, from unresolved periods.
	 *
	 * @param object[]    $periods     Configured sale periods.
	 * @param string      $now         Current site datetime.
	 * @param string|null $default_end Lazy default sale end.
	 * @param bool        $continues   Whether the continues fallback is enabled.
	 * @return bool Whether online sales are reported as closed.
	 */
	private function sales_closed( array $periods, $now, $default_end = null, $continues = false ) {
		return TicketAvailability::resolve_period_context_from_periods( $periods, $now, $default_end, $continues )['sales_closed'];
	}

	/**
	 * Once the only period's explicit end has passed, sales are closed.
	 */
	public function test_sales_closed_after_explicit_end() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertTrue( $this->sales_closed( array( $period ), '2026-03-01 00:00:00' ) );
	}

	/**
	 * The closing boundary is exact: still on sale the second before
	 * sale_end, closed at sale_end itself (half-open interval).
	 */
	public function test_sales_closed_at_exact_end_boundary() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertFalse( $this->sales_closed( array( $period ), '2026-01-31 23:59:59' ) );
		$this->assertTrue( $this->sales_closed( array( $period ), '2026-02-01 00:00:00' ) );
	}

	/**
	 * A last period with no stored end closes at the inferred default end —
	 * the day after the last occurrence — and not before.
	 */
	public function test_sales_closed_at_inferred_end() {
		$period      = $this->period( '2026-01-01 00:00:00', null );
		$default_end = TicketAvailability::compute_default_sale_end( '2026-06-15 18:30:00' );

		$this->assertFalse( $this->sales_closed( array( $period ), '2026-06-15 23:59:59', $default_end ) );
		$this->assertTrue( $this->sales_closed( array( $period ), '2026-06-16 00:00:00', $default_end ) );
	}

	/**
	 * A fully unset window (inferred start and end) closes at the inferred
	 * end too: the first period's start stops resolving only because its own
	 * end has passed, which is closure rather than missing configuration.
	 */
	public function test_sales_closed_with_inferred_start_and_end() {
		$period      = $this->period( null, null );
		$default_end = TicketAvailability::compute_default_sale_end( '2026-06-15 18:30:00' );

		$this->assertFalse( $this->sales_closed( array( $period ), '2026-06-15 12:00:00', $default_end ) );
		$this->assertTrue( $this->sales_closed( array( $period ), '2026-06-16 00:00:00', $default_end ) );
	}

	/**
	 * The inferred end is a site-local midnight: in a non-UTC site timezone
	 * sales close at local midnight after the last occurrence, compared
	 * against site-local "now", with no UTC shift either way.
	 */
	public function test_sales_closed_uses_site_local_time_in_non_utc_timezone() {
		$GLOBALS['_fair_test_timezone'] = 'Pacific/Auckland';

		try {
			$period      = $this->period( '2026-01-01 00:00:00', null );
			$default_end = TicketAvailability::compute_default_sale_end( '2026-06-15 23:30:00' );

			$this->assertSame( '2026-06-16 00:00:00', $default_end );
			// 23:59:59 on the 15th in Auckland is still the 15th in UTC.
			$this->assertFalse( $this->sales_closed( array( $period ), '2026-06-15 23:59:59', $default_end ) );
			// Local midnight on the 16th is only midday on the 15th in UTC.
			$this->assertTrue( $this->sales_closed( array( $period ), '2026-06-16 00:00:00', $default_end ) );
		} finally {
			unset( $GLOBALS['_fair_test_timezone'] );
		}
	}

	/**
	 * Every period of a sequence must have ended before sales are closed.
	 */
	public function test_sales_closed_after_every_period_ended() {
		$first = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$last  = $this->period( '2026-02-01 00:00:00', '2026-03-01 00:00:00' );

		$this->assertFalse( $this->sales_closed( array( $first, $last ), '2026-02-15 00:00:00' ) );
		$this->assertTrue( $this->sales_closed( array( $first, $last ), '2026-03-01 00:00:00' ) );
	}

	/**
	 * A period that hasn't started yet is not closed sales.
	 */
	public function test_sales_not_closed_before_future_period() {
		$period = $this->period( '2026-06-01 00:00:00', '2026-07-01 00:00:00' );
		$this->assertFalse( $this->sales_closed( array( $period ), '2026-01-01 00:00:00' ) );
	}

	/**
	 * A gap between an ended period and a later one is not closed sales.
	 */
	public function test_sales_not_closed_in_gap_between_periods() {
		$earlier = $this->period( '2026-01-01 00:00:00', '2026-01-15 00:00:00' );
		$later   = $this->period( '2026-02-01 00:00:00', '2026-02-15 00:00:00' );
		$this->assertFalse( $this->sales_closed( array( $earlier, $later ), '2026-01-20 00:00:00' ) );
	}

	/**
	 * No configured periods is missing configuration, not closed sales.
	 */
	public function test_sales_not_closed_without_periods() {
		$this->assertFalse( $this->sales_closed( array(), '2026-01-20 00:00:00' ) );
	}

	/**
	 * An end that can't be resolved (nothing stored, no occurrence to infer
	 * from) is never reported as closed.
	 */
	public function test_sales_not_closed_with_unresolved_end() {
		$period = $this->period( '2026-01-01 00:00:00', null );
		$this->assertFalse( $this->sales_closed( array( $period ), '2030-01-01 00:00:00', null ) );
	}

	/**
	 * An interior period missing its end leaves the sequence unresolved even
	 * after every known end has passed.
	 */
	public function test_sales_not_closed_with_unresolved_interior_end() {
		$first    = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$interior = $this->period( '2026-02-01 00:00:00', null );
		$last     = $this->period( '2026-03-01 00:00:00', '2026-04-01 00:00:00' );

		$this->assertFalse( $this->sales_closed( array( $first, $interior, $last ), '2026-05-01 00:00:00', '2026-04-01 00:00:00' ) );
	}

	/**
	 * An interior period missing its start is unresolved configuration, not
	 * closed sales — only the first period's start may be inferred.
	 */
	public function test_sales_not_closed_with_unresolved_interior_start() {
		$first    = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$interior = $this->period( '', '2026-03-01 00:00:00' );
		$last     = $this->period( '2026-03-01 00:00:00', '2026-04-01 00:00:00' );

		$this->assertFalse( $this->sales_closed( array( $first, $interior, $last ), '2026-05-01 00:00:00' ) );
	}

	/**
	 * While the continues_pricing_period fallback keeps the last period on
	 * sale past its end, sales are not closed.
	 */
	public function test_sales_not_closed_while_continues_fallback_is_active() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );

		$this->assertFalse( $this->sales_closed( array( $period ), '2026-03-01 00:00:00', null, true ) );
		$this->assertTrue( $this->sales_closed( array( $period ), '2026-03-01 00:00:00', null, false ) );
	}

	/**
	 * An enabled type (no disabled flag, no disable_at) is enabled.
	 */
	public function test_is_ticket_type_enabled_default_is_enabled() {
		$type = $this->ticket_type( 1 );
		$this->assertTrue( TicketAvailability::is_ticket_type_enabled( $type, '2026-01-01 00:00:00' ) );
	}

	/**
	 * Manual disabling takes precedence over any scheduled window.
	 */
	public function test_is_ticket_type_enabled_false_when_manually_disabled() {
		$type           = $this->ticket_type( 1 );
		$type->disabled = true;
		$this->assertFalse( TicketAvailability::is_ticket_type_enabled( $type, '2026-01-01 00:00:00' ) );
	}

	/**
	 * The scheduled disable boundary is reached: no longer enabled.
	 */
	public function test_is_ticket_type_enabled_false_at_disable_at_boundary() {
		$type             = $this->ticket_type( 1 );
		$type->disable_at = '2026-01-01 12:00:00';
		$this->assertFalse( TicketAvailability::is_ticket_type_enabled( $type, '2026-01-01 12:00:00' ) );
	}

	/**
	 * A future scheduled disable time remains enabled.
	 */
	public function test_is_ticket_type_enabled_true_before_disable_at() {
		$type             = $this->ticket_type( 1 );
		$type->disable_at = '2026-01-01 12:00:01';
		$this->assertTrue( TicketAvailability::is_ticket_type_enabled( $type, '2026-01-01 12:00:00' ) );
	}
}
