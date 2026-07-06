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
}
