<?php
/**
 * TicketPricing sale-period boundary tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\TicketPricing;

/**
 * Validates the pure period-selection math used by resolve_active_sale_period().
 * Database-backed lookups are exercised via API integration tests, not here.
 */
class TicketPricingTest extends TestCase {

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
	 * No periods configured at all.
	 */
	public function test_no_periods_returns_null() {
		$this->assertNull( TicketPricing::pick_active_period( array(), '2026-01-15 00:00:00', false ) );
	}

	/**
	 * Period context preserves both the selected period and configured count.
	 */
	public function test_sale_period_context_returns_active_period_and_count() {
		$past   = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$active = $this->period( '2026-02-01 00:00:00', '2026-03-01 00:00:00' );

		$context = TicketPricing::resolve_sale_period_context_from_periods(
			array( $past, $active ),
			'2026-02-15 00:00:00',
			null
		);

		$this->assertEquals( $active, $context['active_period'] );
		$this->assertSame( 2, $context['sale_period_count'] );
	}

	/**
	 * Empty period context exposes a zero count and no active period.
	 */
	public function test_sale_period_context_is_empty_when_unconfigured() {
		$context = TicketPricing::resolve_sale_period_context_from_periods( array(), '2026-02-15 00:00:00', null );

		$this->assertNull( $context['active_period'] );
		$this->assertSame( 0, $context['sale_period_count'] );
	}

	/**
	 * Now falls inside a period's range.
	 */
	public function test_period_containing_now_is_active() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertSame( $period, TicketPricing::pick_active_period( array( $period ), '2026-01-15 00:00:00', false ) );
	}

	/**
	 * The sale_end day is the first day no longer on sale.
	 */
	public function test_end_day_is_exclusive() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		// Half-open interval: sale_end itself is no longer on sale.
		$this->assertNull( TicketPricing::pick_active_period( array( $period ), '2026-02-01 00:00:00', false ) );
	}

	/**
	 * The sale_start day is the first day on sale.
	 */
	public function test_start_day_is_inclusive() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertSame( $period, TicketPricing::pick_active_period( array( $period ), '2026-01-01 00:00:00', false ) );
	}

	/**
	 * Without continues_pricing_period, nothing sells after the last period ends.
	 */
	public function test_after_last_period_without_continues_returns_null() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertNull( TicketPricing::pick_active_period( array( $period ), '2026-03-01 00:00:00', false ) );
	}

	/**
	 * With continues_pricing_period, the last period keeps selling after its own end.
	 */
	public function test_after_last_period_with_continues_falls_back_to_it() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertSame( $period, TicketPricing::pick_active_period( array( $period ), '2026-03-01 00:00:00', true ) );
	}

	/**
	 * Manual disabling takes precedence over active pricing.
	 */
	public function test_filter_removes_manually_disabled_type() {
		$type           = $this->ticket_type( 1 );
		$type->disabled = true;
		$this->assertSame( array(), TicketPricing::filter_purchasable_types( array( $type ), array( 1 => 10.0 ), array( 1 ), '2026-01-01 12:00:00' ) );
	}

	/**
	 * The scheduled disable boundary is no longer available.
	 */
	public function test_filter_removes_type_at_disable_at_boundary() {
		$type             = $this->ticket_type( 1 );
		$type->disable_at = '2026-01-01 12:00:00';
		$this->assertSame( array(), TicketPricing::filter_purchasable_types( array( $type ), array( 1 => 10.0 ), array( 1 ), '2026-01-01 12:00:00' ) );
	}

	/**
	 * A future scheduled disable time remains available.
	 */
	public function test_filter_keeps_type_before_disable_at() {
		$type             = $this->ticket_type( 1 );
		$type->disable_at = '2026-01-01 12:00:01';
		$this->assertSame( array( $type ), TicketPricing::filter_purchasable_types( array( $type ), array( 1 => 10.0 ), array( 1 ), '2026-01-01 12:00:00' ) );
	}

	/**
	 * The fallback never jumps ahead to a period that hasn't started yet.
	 */
	public function test_continues_fallback_only_applies_to_last_period_after_its_own_start() {
		$earlier = $this->period( '2026-01-01 00:00:00', '2026-01-15 00:00:00' );
		$later   = $this->period( '2026-02-01 00:00:00', '2026-02-15 00:00:00' );
		// Now is between the two periods, before the last period's own start —
		// continues_pricing_period should not jump ahead to a future period.
		$this->assertNull( TicketPricing::pick_active_period( array( $earlier, $later ), '2026-01-20 00:00:00', true ) );
	}

	/**
	 * The fallback only ever considers the last period, never an earlier one.
	 */
	public function test_continues_fallback_ignores_non_last_period() {
		$earlier = $this->period( '2026-01-01 00:00:00', '2026-01-15 00:00:00' );
		$later   = $this->period( '2026-02-01 00:00:00', '2026-02-15 00:00:00' );
		// Now is after the earlier period's own end but the later period hasn't
		// started yet — the fallback only ever considers the last period.
		$this->assertNull( TicketPricing::pick_active_period( array( $earlier, $later ), '2026-01-16 00:00:00', true ) );
	}

	/**
	 * No periods start in the future.
	 */
	public function test_pick_upcoming_period_no_future_period_returns_null() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertNull( TicketPricing::pick_upcoming_period( array( $period ), '2026-03-01 00:00:00' ) );
	}

	/**
	 * A period starting in the future is picked as upcoming.
	 */
	public function test_pick_upcoming_period_picks_future_period() {
		$period = $this->period( '2026-06-01 00:00:00', '2026-07-01 00:00:00' );
		$this->assertSame( $period, TicketPricing::pick_upcoming_period( array( $period ), '2026-01-01 00:00:00' ) );
	}

	/**
	 * Of several future periods, the earliest-starting one is picked.
	 */
	public function test_pick_upcoming_period_picks_earliest_future_period() {
		$later   = $this->period( '2026-08-01 00:00:00', '2026-09-01 00:00:00' );
		$earlier = $this->period( '2026-06-01 00:00:00', '2026-07-01 00:00:00' );
		$this->assertSame(
			$earlier,
			TicketPricing::pick_upcoming_period( array( $later, $earlier ), '2026-01-01 00:00:00' )
		);
	}

	/**
	 * A period whose sale_start equals now has already started, so it's not
	 * "upcoming" — matches pick_active_period()'s inclusive start.
	 */
	public function test_pick_upcoming_period_start_equal_to_now_is_not_upcoming() {
		$period = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$this->assertNull( TicketPricing::pick_upcoming_period( array( $period ), '2026-01-01 00:00:00' ) );
	}

	/**
	 * An unset sale_end substitutes the computed default.
	 */
	public function test_apply_default_window_substitutes_unset_end() {
		$period   = $this->period( '2026-01-01 00:00:00', null );
		$resolved = TicketPricing::apply_default_window( array( $period ), '2026-03-01 00:00:00' );
		$this->assertSame( '2026-03-01 00:00:00', $resolved[0]->sale_end );
		// The original period object is untouched — apply_default_window clones.
		$this->assertNull( $period->sale_end );
	}

	/**
	 * An unset sale_start becomes open (always already started).
	 */
	public function test_apply_default_window_unset_start_is_open() {
		$period   = $this->period( '', '2026-06-01 00:00:00' );
		$resolved = TicketPricing::apply_default_window( array( $period ), null );
		$this->assertSame( TicketPricing::OPEN_START_SENTINEL, $resolved[0]->sale_start );
	}

	/**
	 * Explicit sale_start/sale_end values are left untouched.
	 */
	public function test_apply_default_window_leaves_explicit_values_untouched() {
		$period   = $this->period( '2026-01-01 00:00:00', '2026-02-01 00:00:00' );
		$resolved = TicketPricing::apply_default_window( array( $period ), '2026-09-01 00:00:00' );
		$this->assertSame( '2026-01-01 00:00:00', $resolved[0]->sale_start );
		$this->assertSame( '2026-02-01 00:00:00', $resolved[0]->sale_end );
	}

	/**
	 * With no default end available (e.g. the event/series has no occurrences),
	 * an unset sale_end is left unset rather than substituting a bogus value.
	 */
	public function test_apply_default_window_without_default_end_leaves_end_unset() {
		$period   = $this->period( '2026-01-01 00:00:00', null );
		$resolved = TicketPricing::apply_default_window( array( $period ), null );
		$this->assertNull( $resolved[0]->sale_end );
	}

	/**
	 * Compute_default_sale_end() returns the day after the last occurrence at
	 * midnight site time, regardless of the occurrence's own time-of-day.
	 */
	public function test_compute_default_sale_end_is_day_after_at_midnight() {
		$this->assertSame(
			'2026-06-16 00:00:00',
			TicketPricing::compute_default_sale_end( '2026-06-15 18:30:00' )
		);
	}

	/**
	 * With no occurrence to anchor to, there is no default.
	 */
	public function test_compute_default_sale_end_null_input_returns_null() {
		$this->assertNull( TicketPricing::compute_default_sale_end( null ) );
	}

	/**
	 * End-to-end: an unset window resolves through pick_active_period() as
	 * purchasable up through the day after the last occurrence — never
	 * "closed" just because nothing was ever stored.
	 */
	public function test_unset_window_resolves_purchasable_through_default_end() {
		$period      = $this->period( null, null );
		$default_end = TicketPricing::compute_default_sale_end( '2026-06-15 18:30:00' );
		$resolved    = TicketPricing::apply_default_window( array( $period ), $default_end );
		$this->assertSame( $resolved[0], TicketPricing::pick_active_period( $resolved, '2026-06-15 12:00:00', true ) );
		// The final day (day after the occurrence) is no longer on sale — half-open range.
		$this->assertNull( TicketPricing::pick_active_period( $resolved, '2026-06-16 00:00:00', false ) );
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
	 * A type with a price row for the active period is kept.
	 */
	public function test_filter_purchasable_types_keeps_priced_type() {
		$type = $this->ticket_type( 1 );
		$this->assertSame(
			array( $type ),
			TicketPricing::filter_purchasable_types( array( $type ), array( 1 => 12.5 ) )
		);
	}

	/**
	 * A type priced for some other period, but not the active one, is
	 * dropped — its sale window lapsed.
	 */
	public function test_filter_purchasable_types_removes_type_priced_elsewhere() {
		$priced           = $this->ticket_type( 1 );
		$priced_elsewhere = $this->ticket_type( 2 );
		$this->assertSame(
			array( $priced ),
			TicketPricing::filter_purchasable_types(
				array( $priced, $priced_elsewhere ),
				array( 1 => 12.5 ),
				array( 1, 2 )
			)
		);
	}

	/**
	 * A 0-price row still counts as configured/kept — its presence in the map
	 * is the signal, not the price value.
	 */
	public function test_filter_purchasable_types_keeps_zero_priced_type() {
		$type = $this->ticket_type( 1 );
		$this->assertSame(
			array( $type ),
			TicketPricing::filter_purchasable_types( array( $type ), array( 1 => 0.0 ), array( 1 ) )
		);
	}

	/**
	 * A type that has never had a price row for any period is free by
	 * convention (the admin ticket editor leaves a blank price cell unsaved)
	 * and stays, even though it's absent from $price_by_type_id.
	 */
	public function test_filter_purchasable_types_keeps_never_priced_type() {
		$type = $this->ticket_type( 1 );
		$this->assertSame(
			array( $type ),
			TicketPricing::filter_purchasable_types( array( $type ), array(), array() )
		);
	}

	/**
	 * Covers base_prices_for_types() — the bulk counterpart to
	 * resolve_unit_price(), consumed by callers resolving many types from
	 * one resolve_unit_prices_for_event_date() call instead of once per type
	 * (issue #1299). Mirrors resolve_unit_price()'s exact per-type rules.
	 */

	/**
	 * A type with a price row for the active period resolves to that price.
	 */
	public function test_base_prices_for_types_uses_active_period_price() {
		$result = TicketPricing::base_prices_for_types( array( 1 ), array( 1 => 12.5 ), array( 1 ) );

		$this->assertSame( array( 1 => 12.5 ), $result );
	}

	/**
	 * A type never priced for any period is free by convention, even though
	 * it's absent from $price_by_type_id.
	 */
	public function test_base_prices_for_types_never_priced_is_free() {
		$result = TicketPricing::base_prices_for_types( array( 1 ), array(), array() );

		$this->assertSame( array( 1 => 0.0 ), $result );
	}

	/**
	 * A type priced for some other period, but not the active one, is
	 * omitted entirely — not purchasable right now, matching
	 * resolve_unit_price()'s null.
	 */
	public function test_base_prices_for_types_omits_type_priced_elsewhere() {
		$result = TicketPricing::base_prices_for_types( array( 1, 2 ), array( 1 => 12.5 ), array( 1, 2 ) );

		$this->assertSame( array( 1 => 12.5 ), $result );
	}

	/**
	 * Several requested types resolve independently in one call, each under
	 * its own rule (priced, free-by-convention, or omitted) — the "query
	 * count doesn't scale with tier count" guarantee reduces to this being a
	 * single pure pass over the maps already fetched once.
	 */
	public function test_base_prices_for_types_resolves_several_types_independently() {
		$price_by_type_id = array(
			1 => 10.0,
			3 => 0.0,
		);
		$priced_type_ids  = array( 1, 2, 3 );

		$result = TicketPricing::base_prices_for_types( array( 1, 2, 3, 4 ), $price_by_type_id, $priced_type_ids );

		$this->assertSame(
			array(
				1 => 10.0,
				// 2 omitted: priced for another period, not the active one.
				3 => 0.0,
				4 => 0.0, // never priced anywhere → free by convention.
			),
			$result
		);
	}
}
