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
}
