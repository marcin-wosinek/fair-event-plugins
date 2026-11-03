<?php
/**
 * EventPricingSchedule display-schedule assembly tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\EventPricingSchedule;
use FairEvents\Services\TicketAvailability;

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
	 * Multiple ticket types across multiple periods: each period lists only
	 * the types priced in it, in the configured period order.
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
		$this->assertSame( array( 1, 2 ), array_column( $result['periods'][0]['entries'], 'ticket_type_id' ) );
		$this->assertSame( 'priced', $result['periods'][0]['entries'][0]['state'] );
		$this->assertSame( 'priced', $result['periods'][0]['entries'][1]['state'] );

		// Period 2: early bird has no row for this period — left out, not
		// guessed as free.
		$this->assertSame( array( 2 ), array_column( $result['periods'][1]['entries'], 'ticket_type_id' ) );
		$this->assertSame( 'priced', $result['periods'][1]['entries'][0]['state'] );
		$this->assertSame( 20.0, $result['periods'][1]['entries'][0]['price'] );
	}

	/**
	 * The #2165 example: five ticket types, only two of them on sale in
	 * Early bird. Each period lists just its available tickets, keeping
	 * names, prices, the configured order, and free tickets as "free".
	 */
	public function test_mixed_availability_lists_only_available_tickets_per_period() {
		$types   = array(
			$this->ticket_type( 1, '2 workshops' ),
			$this->ticket_type( 2, 'Fusion pass' ),
			$this->ticket_type( 3, 'Bring a friend' ),
			$this->ticket_type( 4, 'Workshop 1' ),
			$this->ticket_type( 5, 'Workshop 2' ),
		);
		$periods = array(
			$this->period( 10, 'Early bird', '2026-01-01 00:00:00', '2026-02-01 00:00:00' ),
			$this->period( 11, 'Regular', '2026-02-01 00:00:00', '2026-03-01 00:00:00' ),
		);
		$prices  = array(
			// Price rows in a different order than the ticket types, so the
			// entry order provably follows the configured type order.
			$this->price( 2, 10, 120.0 ),
			$this->price( 1, 10, 60.0 ),
			$this->price( 5, 11, 35.0 ),
			$this->price( 4, 11, 35.0 ),
			$this->price( 3, 11, 0.0 ),
			$this->price( 2, 11, 140.0 ),
			$this->price( 1, 11, 70.0 ),
		);

		$result = EventPricingSchedule::build_schedule( $types, $periods, $prices );

		$this->assertTrue( $result['has_prices'] );
		$this->assertSame(
			array(
				array(
					'ticket_type_id' => 1,
					'name'           => '2 workshops',
					'state'          => 'priced',
					'price'          => 60.0,
				),
				array(
					'ticket_type_id' => 2,
					'name'           => 'Fusion pass',
					'state'          => 'priced',
					'price'          => 120.0,
				),
			),
			$result['periods'][0]['entries']
		);
		$this->assertSame(
			array( '2 workshops', 'Fusion pass', 'Bring a friend', 'Workshop 1', 'Workshop 2' ),
			array_column( $result['periods'][1]['entries'], 'name' )
		);
		$this->assertSame(
			array( 'priced', 'priced', 'free', 'priced', 'priced' ),
			array_column( $result['periods'][1]['entries'], 'state' )
		);
		$this->assertSame(
			array( 70.0, 140.0, null, 35.0, 35.0 ),
			array_column( $result['periods'][1]['entries'], 'price' )
		);
	}

	/**
	 * An explicit zero-price row is "free" and stays listed — the only
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
	 * A ticket type with no price row anywhere produces no entry in any
	 * period — it is never shown as "free".
	 */
	public function test_missing_price_row_is_omitted_not_free() {
		$result = EventPricingSchedule::build_schedule(
			array(
				$this->ticket_type( 1, 'Priced' ),
				$this->ticket_type( 2, 'Never priced' ),
			),
			array( $this->period( 10, null, '2026-01-01 00:00:00', '2026-12-01 00:00:00' ) ),
			array( $this->price( 1, 10, 15.0 ) )
		);

		$this->assertCount( 1, $result['periods'] );
		$this->assertCount( 1, $result['periods'][0]['entries'] );
		$this->assertSame( 1, $result['periods'][0]['entries'][0]['ticket_type_id'] );
		$this->assertSame( 'priced', $result['periods'][0]['entries'][0]['state'] );
	}

	/**
	 * A manually disabled ticket type is dropped from the schedule entirely,
	 * even where it has a price row.
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
	 * An empty first start shows the event's creation day, also once the
	 * period has ended (issue #1841), while later periods keep their dates.
	 */
	public function test_empty_first_start_shows_creation_day_for_historical_period() {
		$now      = '2026-05-20 09:00:00';
		$periods  = array(
			$this->period( 10, 'Early', null, '2026-04-01 00:00:00' ),
			$this->period( 11, 'Regular', '2026-04-01 00:00:00', '2026-06-01 00:00:00' ),
		);
		$resolved = TicketAvailability::resolve_periods( $periods, $now, null, '2026-03-10 00:00:00' );

		$result = EventPricingSchedule::build_schedule(
			array( $this->ticket_type( 1, 'General' ) ),
			$resolved,
			array( $this->price( 1, 10, 10.0 ), $this->price( 1, 11, 15.0 ) ),
			$now
		);

		$this->assertCount( 2, $result['periods'] );
		$this->assertSame( '2026-03-10 00:00:00', $result['periods'][0]['sale_start'] );
		$this->assertSame( '2026-04-01 00:00:00', $result['periods'][0]['sale_end'] );
		$this->assertSame( '2026-04-01 00:00:00', $result['periods'][1]['sale_start'] );
	}

	/**
	 * A period where no ticket type is available (no price rows there) is
	 * omitted — an empty card would only confuse.
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
	 * Dropping an empty interior period never shifts its neighbours: the
	 * lazy boundaries were resolved against every configured period first.
	 */
	public function test_empty_interior_period_keeps_neighbour_boundaries() {
		$now      = '2026-01-15 09:00:00';
		$periods  = array(
			$this->period( 10, 'Early', null, '2026-02-01 00:00:00' ),
			$this->period( 11, 'Unpriced', '2026-02-01 00:00:00', '2026-03-01 00:00:00' ),
			$this->period( 12, 'Late', '2026-03-01 00:00:00', null ),
		);
		$resolved = TicketAvailability::resolve_periods( $periods, $now, '2026-04-01 00:00:00', '2026-01-01 00:00:00' );

		$result = EventPricingSchedule::build_schedule(
			array(
				$this->ticket_type( 1, 'General' ),
				$this->ticket_type( 2, 'Student' ),
			),
			$resolved,
			array(
				$this->price( 1, 10, 10.0 ),
				$this->price( 2, 12, 0.0 ),
			),
			$now
		);

		$this->assertTrue( $result['has_prices'] );
		$this->assertSame( array( 10, 12 ), array_column( $result['periods'], 'id' ) );
		$this->assertSame( '2026-01-01 00:00:00', $result['periods'][0]['sale_start'] );
		$this->assertSame( '2026-02-01 00:00:00', $result['periods'][0]['sale_end'] );
		$this->assertSame( '2026-03-01 00:00:00', $result['periods'][1]['sale_start'] );
		$this->assertSame( '2026-04-01 00:00:00', $result['periods'][1]['sale_end'] );
		$this->assertSame( array( 1 ), array_column( $result['periods'][0]['entries'], 'ticket_type_id' ) );
		$this->assertSame( array( 2 ), array_column( $result['periods'][1]['entries'], 'ticket_type_id' ) );
		$this->assertSame( 'free', $result['periods'][1]['entries'][0]['state'] );
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

	/**
	 * A three-type, three-period schedule (Full Pass / Day Pass / Workshop
	 * across Early Bird / Regular / Last minute) used by the filter tests.
	 * Workshop is free in Regular and has no price row in Early Bird.
	 *
	 * @return array build_schedule() output.
	 */
	private function festival_schedule() {
		return EventPricingSchedule::build_schedule(
			array(
				$this->ticket_type( 1, 'Full Pass' ),
				$this->ticket_type( 2, 'Day Pass' ),
				$this->ticket_type( 3, 'Workshop' ),
			),
			array(
				$this->period( 10, 'Early Bird', '2026-01-01 00:00:00', '2026-02-01 00:00:00' ),
				$this->period( 11, 'Regular', '2026-02-01 00:00:00', '2026-03-01 00:00:00' ),
				$this->period( 12, 'Last minute', '2026-03-01 00:00:00', '2026-04-01 00:00:00' ),
			),
			array(
				$this->price( 1, 10, 90.0 ),
				$this->price( 1, 11, 120.0 ),
				$this->price( 1, 12, 150.0 ),
				$this->price( 2, 10, 50.0 ),
				$this->price( 2, 11, 65.0 ),
				$this->price( 2, 12, 80.0 ),
				$this->price( 3, 11, 0.0 ),
				$this->price( 3, 12, 35.0 ),
			)
		);
	}

	/**
	 * Map a filtered schedule to period ID => list of ticket type IDs.
	 *
	 * @param array $schedule Schedule.
	 * @return array<int, int[]> Shape summary.
	 */
	private function shape( array $schedule ) {
		$shape = array();
		foreach ( $schedule['periods'] as $period ) {
			$shape[ $period['id'] ] = array_column( $period['entries'], 'ticket_type_id' );
		}
		return $shape;
	}

	/**
	 * No exclusions leaves the schedule untouched.
	 */
	public function test_filter_without_exclusions_is_identity() {
		$schedule = $this->festival_schedule();

		$this->assertSame( $schedule, EventPricingSchedule::filter_schedule( $schedule, array(), array() ) );
	}

	/**
	 * Hiding a ticket type removes its row from every period.
	 */
	public function test_filter_hides_ticket_type_rows() {
		$result = EventPricingSchedule::filter_schedule( $this->festival_schedule(), array( 2 ), array() );

		$this->assertSame(
			array(
				10 => array( 1 ),
				11 => array( 1, 3 ),
				12 => array( 1, 3 ),
			),
			$this->shape( $result )
		);
		$this->assertTrue( $result['has_prices'] );
	}

	/**
	 * Hiding a sale period removes its whole section.
	 */
	public function test_filter_hides_sale_period_section() {
		$result = EventPricingSchedule::filter_schedule( $this->festival_schedule(), array(), array( 12 ) );

		$this->assertSame( array( 10, 11 ), array_keys( $this->shape( $result ) ) );
	}

	/**
	 * The motivating case: only Full Pass, only Early Bird and Regular. The
	 * remaining periods keep their resolved dates and prices.
	 */
	public function test_filter_combined_keeps_boundaries_and_prices() {
		$result = EventPricingSchedule::filter_schedule( $this->festival_schedule(), array( 2, 3 ), array( 12 ) );

		$this->assertSame(
			array(
				10 => array( 1 ),
				11 => array( 1 ),
			),
			$this->shape( $result )
		);
		$this->assertSame( '2026-01-01 00:00:00', $result['periods'][0]['sale_start'] );
		$this->assertSame( '2026-02-01 00:00:00', $result['periods'][0]['sale_end'] );
		$this->assertSame( '2026-02-01 00:00:00', $result['periods'][1]['sale_start'] );
		$this->assertSame( '2026-03-01 00:00:00', $result['periods'][1]['sale_end'] );
		$this->assertSame( 90.0, $result['periods'][0]['entries'][0]['price'] );
		$this->assertSame( 120.0, $result['periods'][1]['entries'][0]['price'] );
	}

	/**
	 * A section emptied by the block's hidden ticket types is dropped, while
	 * the remaining sections keep their dates and free/priced states.
	 */
	public function test_filter_drops_sections_left_empty_and_keeps_states() {
		// Only Workshop remains: free in Regular, priced in Last minute, not
		// on sale in Early Bird — so Early Bird disappears.
		$result = EventPricingSchedule::filter_schedule( $this->festival_schedule(), array( 1, 2 ), array() );

		$this->assertTrue( $result['has_prices'] );
		$this->assertSame( array( 11, 12 ), array_keys( $this->shape( $result ) ) );
		$this->assertSame( 'free', $result['periods'][0]['entries'][0]['state'] );
		$this->assertNull( $result['periods'][0]['entries'][0]['price'] );
		$this->assertSame( 'priced', $result['periods'][1]['entries'][0]['state'] );
		$this->assertSame( '2026-02-01 00:00:00', $result['periods'][0]['sale_start'] );
		$this->assertSame( '2026-03-01 00:00:00', $result['periods'][0]['sale_end'] );
		$this->assertSame( '2026-03-01 00:00:00', $result['periods'][1]['sale_start'] );
		$this->assertSame( '2026-04-01 00:00:00', $result['periods'][1]['sale_end'] );
	}

	/**
	 * Hiding everything yields the empty "no prices" schedule.
	 */
	public function test_filter_hiding_everything_yields_empty_schedule() {
		$by_type   = EventPricingSchedule::filter_schedule( $this->festival_schedule(), array( 1, 2, 3 ), array() );
		$by_period = EventPricingSchedule::filter_schedule( $this->festival_schedule(), array(), array( 10, 11, 12 ) );

		foreach ( array( $by_type, $by_period ) as $result ) {
			$this->assertSame( array(), $result['periods'] );
			$this->assertFalse( $result['has_prices'] );
		}
	}

	/**
	 * Stale IDs (deleted entries) and malformed values are ignored; numeric
	 * strings are accepted.
	 */
	public function test_filter_ignores_stale_and_malformed_ids() {
		$schedule = $this->festival_schedule();

		$this->assertSame( $schedule, EventPricingSchedule::filter_schedule( $schedule, array( 999, -1, 0, 'abc', null, 1.5 ), array( 998 ) ) );
		$this->assertSame( $schedule, EventPricingSchedule::filter_schedule( $schedule, 'not-an-array', null ) );

		$result = EventPricingSchedule::filter_schedule( $schedule, array( '2', '3' ), array( '12' ) );
		$this->assertSame( array( 10, 11 ), array_keys( $this->shape( $result ) ) );
	}
}
