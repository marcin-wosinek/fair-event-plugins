<?php
/**
 * Event Pricing Schedule Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventDates;
use FairEvents\Models\TicketPrice;
use FairEvents\Models\TicketSalePeriod;
use FairEvents\Models\TicketType;

defined( 'WPINC' ) || die;

/**
 * Builds the display-ready pricing schedule the event-prices block renders:
 * one section per sale period, each listing every enabled ticket type's
 * state in that period (free, priced, or not available). Presentation-only —
 * it never decides purchasability for the signup flow, which stays owned by
 * {@see TicketPricing} and {@see TicketAvailability}.
 *
 * Split into a DB-touching composer (build_for_event_date()) and a pure,
 * DB-free assembler (build_schedule()) so flat, multi-period, incomplete,
 * free, disabled, and empty configurations can be covered by unit tests
 * without a database — mirroring how TicketAvailability itself splits DB
 * fetching from pure, unit-tested math.
 */
class EventPricingSchedule {

	/**
	 * Resolve the pricing schedule for an event date from the database.
	 *
	 * @param int $event_date_id Event date ID. For a recurring occurrence,
	 *                            callers must already have pivoted this to the
	 *                            series master, matching event-signup/render.php.
	 * @return array{periods: array, has_prices: bool} See build_schedule().
	 */
	public static function build_for_event_date( $event_date_id ) {
		$ticket_types = TicketType::get_all_by_event_date_id( $event_date_id );
		$sale_periods = TicketSalePeriod::get_all_by_event_date_id( $event_date_id );
		$price_rows   = TicketPrice::get_all_by_event_date_id( $event_date_id );

		$now         = current_time( 'mysql' );
		$default_end = TicketAvailability::compute_default_sale_end( EventDates::get_last_occurrence_boundary( $event_date_id ) );
		$periods     = TicketAvailability::resolve_periods( $sale_periods, $now, $default_end );

		return self::build_schedule( $ticket_types, $periods, $price_rows, $now );
	}

	/**
	 * Pure, DB-free schedule assembly, split out from build_for_event_date()
	 * for unit testing without a database.
	 *
	 * Every enabled ticket type gets one entry per period so the table shows
	 * the full ticket-type/period relationship — a type with no price row for
	 * a period appears there as "not available" rather than being silently
	 * dropped from that period's row, so a visitor can see it isn't on offer
	 * then instead of assuming an omission is an error. Only an explicit
	 * price row is ever "free" or "priced" (issue #1624): a missing row is
	 * never guessed as free.
	 *
	 * @param object[] $ticket_types     TicketType objects.
	 * @param object[] $resolved_periods TicketSalePeriod objects, already run
	 *                                   through TicketAvailability::resolve_periods()
	 *                                   so lazy first/last boundaries are filled in.
	 * @param object[] $price_rows       TicketPrice objects for these ticket types.
	 * @param string   $now              Current site datetime for scheduled
	 *                                   disabling. Defaults to current_time( 'mysql' ).
	 * @return array{
	 *     periods: array<int, array{
	 *         id: int,
	 *         name: string|null,
	 *         sale_start: string,
	 *         sale_end: string,
	 *         entries: array<int, array{
	 *             ticket_type_id: int,
	 *             name: string,
	 *             state: 'free'|'priced'|'unavailable',
	 *             price: float|null
	 *         }>
	 *     }>,
	 *     has_prices: bool
	 * } `periods` lists only sections with at least one displayable (free or
	 *   priced) entry, in their configured order. `has_prices` is false when
	 *   no enabled ticket type has an explicit price in any period — the
	 *   caller's signal to render nothing publicly.
	 */
	public static function build_schedule( array $ticket_types, array $resolved_periods, array $price_rows, $now = null ) {
		$now = $now ?? current_time( 'mysql' );

		$enabled_types = array_values(
			array_filter(
				$ticket_types,
				function ( $ticket_type ) use ( $now ) {
					return TicketAvailability::is_ticket_type_enabled( $ticket_type, $now );
				}
			)
		);

		if ( empty( $enabled_types ) || empty( $resolved_periods ) ) {
			return array(
				'periods'    => array(),
				'has_prices' => false,
			);
		}

		// Index price rows by period, then ticket type, for O(1) lookup below.
		$price_by_period = array();
		foreach ( $price_rows as $row ) {
			$price_by_period[ (int) $row->sale_period_id ][ (int) $row->ticket_type_id ] = (float) $row->price;
		}

		$sections   = array();
		$has_prices = false;

		foreach ( $resolved_periods as $period ) {
			// A period whose boundaries never resolved (an interior period
			// with no configured dates, or a first/last period with nothing
			// to infer from) can never become active or purchasable — it
			// must not be advertised as a real window either.
			if ( empty( $period->sale_start ) || empty( $period->sale_end ) ) {
				continue;
			}

			$period_prices    = $price_by_period[ (int) $period->id ] ?? array();
			$entries          = array();
			$period_has_price = false;

			foreach ( $enabled_types as $ticket_type ) {
				$type_id = (int) $ticket_type->id;

				if ( array_key_exists( $type_id, $period_prices ) ) {
					$price            = $period_prices[ $type_id ];
					$period_has_price = true;
					$entries[]        = array(
						'ticket_type_id' => $type_id,
						'name'           => $ticket_type->name,
						'state'          => $price > 0.0 ? 'priced' : 'free',
						'price'          => $price > 0.0 ? $price : null,
					);
				} else {
					$entries[] = array(
						'ticket_type_id' => $type_id,
						'name'           => $ticket_type->name,
						'state'          => 'unavailable',
						'price'          => null,
					);
				}
			}

			// No displayable (free or priced) entry in this period — every
			// type is either unpriced here or genuinely priced elsewhere;
			// showing an all-"not available" period would only confuse.
			if ( ! $period_has_price ) {
				continue;
			}

			$has_prices = true;
			$sections[] = array(
				'id'         => (int) $period->id,
				'name'       => $period->name,
				'sale_start' => $period->sale_start,
				'sale_end'   => $period->sale_end,
				'entries'    => $entries,
			);
		}

		return array(
			'periods'    => $sections,
			'has_prices' => $has_prices,
		);
	}
}
