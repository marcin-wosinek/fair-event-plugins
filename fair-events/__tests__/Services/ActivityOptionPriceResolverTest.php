<?php
/**
 * ActivityOptionPriceResolver price-selection tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\ActivityOptionPriceResolver;
use FairEvents\Services\TicketAvailability;

/**
 * Validates the pure add-on price selection: a flat price always applies, a
 * sale-period price needs an explicit row for the active period, and a
 * missing price is unavailable rather than free. The active period comes
 * from TicketAvailability, the same authority ticket types use.
 * Database-backed lookups are exercised via API integration tests.
 */
class ActivityOptionPriceResolverTest extends TestCase {

	/**
	 * Build an option stub.
	 *
	 * @param float $price  Stored flat price.
	 * @param bool  $derive Whether the price comes from the active sale period.
	 * @return object
	 */
	private function option( $price, $derive = false ) {
		return (object) array(
			'id'                            => 7,
			'event_date_id'                 => 3,
			'price'                         => $price,
			'derive_price_from_sale_period' => $derive,
		);
	}

	/**
	 * Build a sale period stub.
	 *
	 * @param int         $id         Period ID.
	 * @param string|null $sale_start Start datetime.
	 * @param string|null $sale_end   End datetime.
	 * @return object
	 */
	private function period( $id, $sale_start, $sale_end ) {
		return (object) array(
			'id'         => $id,
			'sale_start' => $sale_start,
			'sale_end'   => $sale_end,
		);
	}

	/** A flat price applies whether or not a sale period is active. */
	public function test_flat_price_ignores_sale_periods() {
		$this->assertSame( 12.5, ActivityOptionPriceResolver::price_for_period( $this->option( 12.5 ), null, array() ) );
		$this->assertSame(
			12.5,
			ActivityOptionPriceResolver::price_for_period( $this->option( 12.5 ), $this->period( 1, null, null ), array( 1 => 99.0 ) )
		);
	}

	/** An explicit zero flat price is free, not unavailable. */
	public function test_zero_flat_price_is_free() {
		$this->assertSame( 0.0, ActivityOptionPriceResolver::price_for_period( $this->option( 0.0 ), null, array() ) );
	}

	/** A sale-period price uses the row for the active period. */
	public function test_active_period_price_is_used() {
		$this->assertSame(
			8.0,
			ActivityOptionPriceResolver::price_for_period(
				$this->option( 20.0, true ),
				$this->period( 2, null, null ),
				array(
					1 => 5.0,
					2 => 8.0,
				)
			)
		);
	}

	/** An explicit zero price for the active period is free. */
	public function test_zero_period_price_is_free() {
		$this->assertSame(
			0.0,
			ActivityOptionPriceResolver::price_for_period( $this->option( 20.0, true ), $this->period( 2, null, null ), array( 2 => 0.0 ) )
		);
	}

	/** No price row for the active period is unavailable — the flat price is not a fallback. */
	public function test_missing_period_price_is_unavailable() {
		$this->assertNull(
			ActivityOptionPriceResolver::price_for_period( $this->option( 20.0, true ), $this->period( 2, null, null ), array( 1 => 5.0 ) )
		);
	}

	/** With no active sale period a sale-period-priced option is unavailable. */
	public function test_no_active_period_is_unavailable() {
		$this->assertNull( ActivityOptionPriceResolver::price_for_period( $this->option( 20.0, true ), null, array( 1 => 5.0 ) ) );
	}

	/**
	 * Once the last period ends, its price keeps applying only when pricing
	 * continues — the same continuation rule ticket types follow.
	 */
	public function test_continuation_keeps_last_period_price() {
		$periods = array(
			$this->period( 1, '2026-01-01 00:00:00', '2026-02-01 00:00:00' ),
			$this->period( 2, '2026-02-01 00:00:00', '2026-03-01 00:00:00' ),
		);
		$prices  = array(
			1 => 5.0,
			2 => 8.0,
		);
		$option  = $this->option( 20.0, true );
		$now     = '2026-03-15 12:00:00';

		$continued = TicketAvailability::resolve_period_context_from_periods( $periods, $now, null, true )['active_period'];
		$this->assertSame( 8.0, ActivityOptionPriceResolver::price_for_period( $option, $continued, $prices ) );

		$closed = TicketAvailability::resolve_period_context_from_periods( $periods, $now, null, false )['active_period'];
		$this->assertNull( ActivityOptionPriceResolver::price_for_period( $option, $closed, $prices ) );
	}

	/** Unavailable options stay unavailable through the discount filter. */
	public function test_charged_prices_keep_unavailable_options_null() {
		$this->assertSame(
			array(
				1 => 10.0,
				2 => null,
				3 => 0.0,
			),
			ActivityOptionPriceResolver::charged_prices(
				array(
					1 => 10.0,
					2 => null,
					3 => 0.0,
				),
				3
			)
		);
	}
}
