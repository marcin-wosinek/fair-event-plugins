<?php
/**
 * EventPricingSchedule display-schedule assembly tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\EventPricingSchedule;

/**
 * Validates the pure per-period, per-ticket-type schedule assembly used by
 * the event-prices block's render.php. Database-backed lookups (and the lazy
 * period-boundary resolution TicketAvailability performs) are exercised via
 * API/E2E tests, not here.
 */
class EventPricingScheduleTest extends TestCase {

	/**
	 * Build a resolved sale-period stub.
	 *
	 * @param int         $id         Sale period ID.
	 * @param string|null $name       Period name.
	 * @param string|null $sale_start Resolved sale start datetime.
	 * @param string|null $sale_end   Resolved sale end datetime.
	 * @return object Anonymous period object.
	 */
	private function period( $id, $name, $sale_start, $sale_end ) {
		return (object) array(
			'id'         => $id,
			'name'       => $name,
			'sale_start' => $sale_start,
			'sale_end'   => $sale_end,
		);
	}

	/**
	 * Build a ticket type stub.
	 *
	 * @param int    $id       Ticket type ID.
	 * @param string $name     Ticket type name.
	 * @param bool   $disabled Whether manually disabled.
	 * @return object Anonymous ticket type object.
	 */
	private function ticket_type( $id, $name, $disabled = false ) {
		return (object) array(
			'id'         => $id,
			'name'       => $name,
			'disabled'   => $disabled,
			'disable_at' => null,
		);
	}

	/**
	 * Build a price row stub.
	 *
	 * @param int   $ticket_type_id Ticket type ID.
	 * @param int   $sale_period_id Sale period ID.
	 * @param float $price          Price.
	 * @return object Anonymous price row object.
	 */
	private function price( $ticket_type_id, $sale_period_id, $price ) {
		return (object) array(
			'ticket_type_id' => $ticket_type_id,
			'sale_period_id' => $sale_period_id,
			'price'          => $price,
		);
	}

	/**
	 * One ticket type, one period, one price row — the flat-pricing case.
	 */
	public function test_single_type_single_period() {
		$result = EventPricingSchedule::build_schedule(
			array( $this->ticket_type( 1, 'General' ) ),
			array( $this->period( 10, 'Always on', '2026-01-01 00:00:00', '2026-12-01 00:00:00' ) ),
			array( $this->price( 1, 10, 15.0 ) )
		);

		$this->assertTrue( $result['has_prices'] );
		$this->assertCount( 1, $result['periods'] );
		$this->assertSame( 10, $result['periods'][0]['id'] );
		$this->assertCount( 1, $result['periods'][0]['entries'] );
		$this->assertSame( 'priced', $result['periods'][0]['entries'][0]['state'] );
		$this->assertSame( 15.0, $result['periods'][0]['entries'][0]['price'] );
	}

	/**
	 * Multiple ticket types across multiple periods each get their own entry,
	 * in the configured period order.
	 */
	public function test_multiple_types_multiple_periods() {
		$types   = array(
			$this->ticket_type( 1, 'Early bird' ),
			$this->ticket_type( 2, 'Regular' ),
		);
		$periods = array(
			$this->period( 10, 'Early bird', '2026-01-01 00:00:00', '2026-02-01 00:00:00' ),
			$this->period( 11, 'Regular', '2026-02-01 00:00:00', '2026-03-01 00:00:00' ),
		);
		$prices  = array(
			$this->price( 1, 10, 10.0 ),
			$this->price( 2, 10, 15.0 ),
			$this->price( 2, 11, 20.0 ),
		);

		$result = EventPricingSchedule::build_schedule( $types, $periods, $prices );

		$this->assertCount( 2, $result['periods'] );
		$this->assertSame( 10, $result['periods'][0]['id'] );
		$this->assertSame( 11, $result['periods'][1]['id'] );

		// Period 1: both types priced.
		$this->assertSame( 'priced', $result['periods'][0]['entries'][0]['state'] );
		$this->assertSame( 'priced', $result['periods'][0]['entries'][1]['state'] );

		// Period 2: early bird has no row for this period — not available,
		// not guessed as free.
		$this->assertSame( 'unavailable', $result['periods'][1]['entries'][0]['state'] );
		$this->assertNull( $result['periods'][1]['entries'][0]['price'] );
		$this->assertSame( 'priced', $result['periods'][1]['entries'][1]['state'] );
	}

	/**
	 * An explicit zero-price row is "free", not "not available" — the only
	 * way a ticket type is ever shown as free (issue #1624).
	 */
	public function test_explicit_zero_price_is_free() {
		$result = EventPricingSchedule::build_schedule(
			array( $this->ticket_type( 1, 'RSVP' ) ),
			array( $this->period( 10, null, '2026-01-01 00:00:00', '2026-12-01 00:00:00' ) ),
			array( $this->price( 1, 10, 0.0 ) )
		);

		$this->assertSame( 'free', $result['periods'][0]['entries'][0]['state'] );
		$this->assertNull( $result['periods'][0]['entries'][0]['price'] );
	}

	/**
	 * A ticket type with no price row anywhere is "not available" in every
	 * period, never "free".
	 */
	public function test_missing_price_row_is_unavailable_not_free() {
		$result = EventPricingSchedule::build_schedule(
			array(
				$this->ticket_type( 1, 'Priced' ),
				$this->ticket_type( 2, 'Never priced' ),
			),
			array( $this->period( 10, null, '2026-01-01 00:00:00', '2026-12-01 00:00:00' ) ),
			array( $this->price( 1, 10, 15.0 ) )
		);

		$this->assertCount( 1, $result['periods'] );
		$this->assertSame( 'priced', $result['periods'][0]['entries'][0]['state'] );
		$this->assertSame( 'unavailable', $result['periods'][0]['entries'][1]['state'] );
	}

	/**
	 * A manually disabled ticket type is dropped from the schedule entirely,
	 * not shown as unavailable.
	 */
	public function test_disabled_type_is_omitted() {
		$result = EventPricingSchedule::build_schedule(
			array(
				$this->ticket_type( 1, 'Active', false ),
				$this->ticket_type( 2, 'Disabled', true ),
			),
			array( $this->period( 10, null, '2026-01-01 00:00:00', '2026-12-01 00:00:00' ) ),
			array(
				$this->price( 1, 10, 15.0 ),
				$this->price( 2, 10, 15.0 ),
			)
		);

		$this->assertCount( 1, $result['periods'][0]['entries'] );
		$this->assertSame( 1, $result['periods'][0]['entries'][0]['ticket_type_id'] );
	}

	/**
	 * A scheduled disable boundary already reached is dropped just like
	 * manual disabling.
	 */
	public function test_scheduled_disabled_type_is_omitted() {
		$type             = $this->ticket_type( 1, 'Lapsed' );
		$type->disable_at = '2026-01-01 12:00:00';

		$result = EventPricingSchedule::build_schedule(
			array( $type ),
			array( $this->period( 10, null, '2026-01-01 00:00:00', '2026-12-01 00:00:00' ) ),
			array( $this->price( 1, 10, 15.0 ) ),
			'2026-01-01 12:00:00'
		);

		$this->assertSame( array(), $result['periods'] );
		$this->assertFalse( $result['has_prices'] );
	}

	/**
	 * A period whose boundaries never resolved (no start or end — an
	 * interior period with nothing configured, or an edge period with
	 * nothing to infer from) is left out of the schedule; it can never be
	 * on sale, so it must not be advertised as a window either.
	 */
	public function test_period_with_unresolved_boundary_is_omitted() {
		$result = EventPricingSchedule::build_schedule(
			array( $this->ticket_type( 1, 'General' ) ),
			array( $this->period( 10, 'Undated', null, null ) ),
			array( $this->price( 1, 10, 15.0 ) )
		);

		$this->assertSame( array(), $result['periods'] );
		$this->assertFalse( $result['has_prices'] );
	}

	/**
	 * A period where nothing is displayable (every type unavailable there)
	 * is omitted — an all-"not available" section would only confuse.
	 */
	public function test_period_with_no_displayable_price_is_omitted() {
		$result = EventPricingSchedule::build_schedule(
			array( $this->ticket_type( 1, 'General' ) ),
			array(
				$this->period( 10, 'Priced', '2026-01-01 00:00:00', '2026-02-01 00:00:00' ),
				$this->period( 11, 'Unpriced', '2026-02-01 00:00:00', '2026-03-01 00:00:00' ),
			),
			array( $this->price( 1, 10, 15.0 ) )
		);

		$this->assertCount( 1, $result['periods'] );
		$this->assertSame( 10, $result['periods'][0]['id'] );
	}

	/**
	 * No ticket types at all yields an empty, "no prices" schedule.
	 */
	public function test_no_ticket_types_yields_empty_schedule() {
		$result = EventPricingSchedule::build_schedule(
			array(),
			array( $this->period( 10, null, '2026-01-01 00:00:00', '2026-12-01 00:00:00' ) ),
			array()
		);

		$this->assertSame( array(), $result['periods'] );
		$this->assertFalse( $result['has_prices'] );
	}

	/**
	 * No sale periods at all yields an empty, "no prices" schedule.
	 */
	public function test_no_periods_yields_empty_schedule() {
		$result = EventPricingSchedule::build_schedule(
			array( $this->ticket_type( 1, 'General' ) ),
			array(),
			array()
		);

		$this->assertSame( array(), $result['periods'] );
		$this->assertFalse( $result['has_prices'] );
	}

	/**
	 * No ticket type ever priced anywhere yields an empty, "no prices"
	 * schedule — the caller's signal to render nothing publicly.
	 */
	public function test_no_prices_anywhere_yields_empty_schedule() {
		$result = EventPricingSchedule::build_schedule(
			array( $this->ticket_type( 1, 'General' ) ),
			array( $this->period( 10, null, '2026-01-01 00:00:00', '2026-12-01 00:00:00' ) ),
			array()
		);

		$this->assertSame( array(), $result['periods'] );
		$this->assertFalse( $result['has_prices'] );
	}
}
