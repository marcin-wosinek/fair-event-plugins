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

	/**
	 * Apply a block's per-instance visibility settings to an already-built
	 * schedule. Pure and display-only: it never touches signup availability
	 * or the Prices configuration.
	 *
	 * Runs after build_schedule() so period boundaries have already been
	 * resolved against every configured period — hiding a period never
	 * shifts the dates shown for its neighbours. IDs that match nothing
	 * (deleted entries, another event's IDs) are ignored.
	 *
	 * @param array $schedule               Output of build_schedule().
	 * @param mixed $hidden_ticket_type_ids Ticket type IDs to hide.
	 * @param mixed $hidden_sale_period_ids Sale period IDs to hide.
	 * @return array{periods: array, has_prices: bool} Same shape as
	 *   build_schedule(): sections left with no free or priced entry are
	 *   dropped, and `has_prices` reflects the filtered result.
	 */
	public static function filter_schedule( array $schedule, $hidden_ticket_type_ids, $hidden_sale_period_ids ) {
		$hidden_types   = self::normalize_ids( $hidden_ticket_type_ids );
		$hidden_periods = self::normalize_ids( $hidden_sale_period_ids );

		$sections = array();

		foreach ( $schedule['periods'] ?? array() as $period ) {
			if ( isset( $hidden_periods[ (int) $period['id'] ] ) ) {
				continue;
			}

			$entries = array_values(
				array_filter(
					$period['entries'],
					function ( $entry ) use ( $hidden_types ) {
						return ! isset( $hidden_types[ (int) $entry['ticket_type_id'] ] );
					}
				)
			);

			$has_displayable = false;
			foreach ( $entries as $entry ) {
				if ( 'unavailable' !== $entry['state'] ) {
					$has_displayable = true;
					break;
				}
			}

			// Same rule as build_schedule(): an all-"not available" section
			// would only confuse visitors.
			if ( ! $has_displayable ) {
				continue;
			}

			$period['entries'] = $entries;
			$sections[]        = $period;
		}

		return array(
			'periods'    => $sections,
			'has_prices' => ! empty( $sections ),
		);
	}

	/**
	 * Normalize a list of IDs from block attributes into a lookup set,
	 * discarding anything that isn't a positive integer.
	 *
	 * @param mixed $ids Raw attribute value.
	 * @return array<int, true> Set keyed by ID.
	 */
	private static function normalize_ids( $ids ) {
		if ( ! is_array( $ids ) ) {
			return array();
		}

		$set = array();
		foreach ( $ids as $id ) {
			if ( is_int( $id ) || ( is_string( $id ) && ctype_digit( $id ) ) ) {
				$id = (int) $id;
				if ( $id > 0 ) {
					$set[ $id ] = true;
				}
			}
		}

		return $set;
	}
}
