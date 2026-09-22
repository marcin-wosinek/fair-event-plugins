<?php
/**
 * TicketPricing price-resolution tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\TicketPricing;

/**
 * Validates the pure price-resolution math used by resolve_unit_price() and
 * its bulk counterparts: only an explicit price row for the active period
 * is purchasable — a missing row is unavailable, whether or not the type is
 * priced elsewhere (issue #1624). Sale-period selection and ticket-type
 * enabled-state math live in TicketAvailabilityTest instead — TicketPricing
 * only delegates to TicketAvailability for those. Database-backed lookups
 * are exercised via API integration tests, not here.
 */
class TicketPricingTest extends TestCase {

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
	 * Manual disabling takes precedence over active pricing.
	 */
	public function test_filter_removes_manually_disabled_type() {
		$type           = $this->ticket_type( 1 );
		$type->disabled = true;
		$this->assertSame( array(), TicketPricing::filter_purchasable_types( array( $type ), array( 1 => 10.0 ), '2026-01-01 12:00:00' ) );
	}

	/**
	 * The scheduled disable boundary is no longer available.
	 */
	public function test_filter_removes_type_at_disable_at_boundary() {
		$type             = $this->ticket_type( 1 );
		$type->disable_at = '2026-01-01 12:00:00';
		$this->assertSame( array(), TicketPricing::filter_purchasable_types( array( $type ), array( 1 => 10.0 ), '2026-01-01 12:00:00' ) );
	}

	/**
	 * A future scheduled disable time remains available.
	 */
	public function test_filter_keeps_type_before_disable_at() {
		$type             = $this->ticket_type( 1 );
		$type->disable_at = '2026-01-01 12:00:01';
		$this->assertSame( array( $type ), TicketPricing::filter_purchasable_types( array( $type ), array( 1 => 10.0 ), '2026-01-01 12:00:00' ) );
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
				array( 1 => 12.5 )
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
			TicketPricing::filter_purchasable_types( array( $type ), array( 1 => 0.0 ) )
		);
	}

	/**
	 * A type that has never had a price row for any period is unavailable,
	 * not free — a blank price cell in the admin ticket editor is left
	 * unsaved and means "not on sale here" (issue #1624).
	 */
	public function test_filter_purchasable_types_removes_never_priced_type() {
		$type = $this->ticket_type( 1 );
		$this->assertSame(
			array(),
			TicketPricing::filter_purchasable_types( array( $type ), array() )
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
		$result = TicketPricing::base_prices_for_types( array( 1 ), array( 1 => 12.5 ) );

		$this->assertSame( array( 1 => 12.5 ), $result );
	}

	/**
	 * A type never priced for any period is omitted, not free — only an
	 * explicit zero row counts as free (issue #1624).
	 */
	public function test_base_prices_for_types_never_priced_is_omitted() {
		$result = TicketPricing::base_prices_for_types( array( 1 ), array() );

		$this->assertSame( array(), $result );
	}

	/**
	 * A type priced for some other period, but not the active one, is
	 * omitted entirely — not purchasable right now, matching
	 * resolve_unit_price()'s null.
	 */
	public function test_base_prices_for_types_omits_type_priced_elsewhere() {
		$result = TicketPricing::base_prices_for_types( array( 1, 2 ), array( 1 => 12.5 ) );

		$this->assertSame( array( 1 => 12.5 ), $result );
	}

	/**
	 * Several requested types resolve independently in one call, each under
	 * its own rule (priced or omitted) — the "query count doesn't scale with
	 * tier count" guarantee reduces to this being a single pure pass over
	 * the map already fetched once.
	 */
	public function test_base_prices_for_types_resolves_several_types_independently() {
		$price_by_type_id = array(
			1 => 10.0,
			3 => 0.0,
		);

		$result = TicketPricing::base_prices_for_types( array( 1, 2, 3, 4 ), $price_by_type_id );

		$this->assertSame(
			array(
				1 => 10.0,
				// 2 and 4 omitted: no explicit price row for the active period.
				3 => 0.0,
			),
			$result
		);
	}
}
