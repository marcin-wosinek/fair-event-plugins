<?php
/**
 * Ticket Pricing Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\TicketPrice;
use FairEvents\Models\TicketType;

defined( 'WPINC' ) || die;

/**
 * Resolves ticket prices for a ticket type. Single source of truth shared by
 * the fair-events get-tickets purchase paths and the fair-events-experimental
 * / fair-audience event-signup pricing service.
 *
 * Time-based sale-period and ticket-type-enabled decisions delegate to
 * {@see TicketAvailability}, the shared availability authority — this class
 * stays responsible for price-row lookup, free-ticket classification, and
 * pricing hooks.
 */
class TicketPricing {

	/**
	 * Resolve the currently active sale period for an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return \FairEvents\Models\TicketSalePeriod|null Active period or null.
	 */
	public static function resolve_active_sale_period( $event_date_id ) {
		return TicketAvailability::resolve_active_sale_period( $event_date_id );
	}

	/**
	 * Resolve the unit price for a ticket type from its currently active
	 * sale period.
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return float|null Unit price, or null when not purchasable right now
	 *                     (unknown ticket type, no active sale period, or no
	 *                     price row configured for it).
	 */
	public static function resolve_unit_price( $ticket_type_id ) {
		$ticket_type = TicketType::get_by_id( $ticket_type_id );
		if ( ! $ticket_type || ! self::is_ticket_type_enabled( $ticket_type ) ) {
			return null;
		}

		$active_period = self::resolve_active_sale_period( $ticket_type->event_date_id );
		if ( ! $active_period ) {
			return null;
		}

		$price_row = TicketPrice::get_by_type_and_period( $ticket_type_id, $active_period->id );
		if ( ! $price_row ) {
			// No explicit price row for this period → unavailable. Only a
			// stored zero price counts as free; a blank price cell in the
			// admin ticket editor is left unsaved and means "not on sale
			// here", not "free" (issue #1624).
			return null;
		}

		/**
		 * Filters the resolved unit price for a ticket type before it's charged.
		 *
		 * Lets discount providers (e.g. group pricing) layer on without this
		 * service knowing about them. Not currently hooked from anywhere —
		 * get-tickets purchases are anonymous, so participant-based discounts
		 * can't resolve here yet.
		 *
		 * @param float $price          Resolved unit price.
		 * @param int   $ticket_type_id Ticket type ID.
		 * @param array $context        Extra context: 'event_date_id', 'sale_period_id'.
		 */
		return (float) apply_filters(
			'fair_events_resolve_ticket_price',
			(float) $price_row->price,
			$ticket_type_id,
			array(
				'event_date_id'  => $ticket_type->event_date_id,
				'sale_period_id' => $active_period->id,
			)
		);
	}

	/**
	 * Resolve the active sale period and every ticket type's price for it in
	 * one pass — the bulk counterpart to resolve_unit_price(), which
	 * re-resolves the active period and re-queries prices from scratch for
	 * every ticket type it's called for. Callers looping over an event
	 * date's ticket types (the signup render, the signup pricing overlay)
	 * should call this once and read the returned maps instead.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array{
	 *     active_period: TicketSalePeriod|null,
	 *     sale_period_count: int,
	 *     price_by_type_id: float[]
	 * } `price_by_type_id` covers only types with an explicit price row for
	 *   the active period — the sole purchasability signal (issue #1624).
	 */
	public static function resolve_unit_prices_for_event_date( $event_date_id ) {
		$period_context = TicketAvailability::resolve_sale_period_context( $event_date_id );
		$active_period  = $period_context['active_period'];
		if ( ! $active_period ) {
			return array(
				'active_period'     => null,
				'sale_period_count' => $period_context['sale_period_count'],
				'price_by_type_id'  => array(),
			);
		}

		$price_by_type_id = array();
		foreach ( TicketPrice::get_all_by_event_date_id( $event_date_id ) as $price_row ) {
			if ( (int) $price_row->sale_period_id === (int) $active_period->id ) {
				$price_by_type_id[ (int) $price_row->ticket_type_id ] = (float) $price_row->price;
			}
		}

		return array(
			'active_period'     => $active_period,
			'sale_period_count' => $period_context['sale_period_count'],
			'price_by_type_id'  => $price_by_type_id,
		);
	}

	/**
	 * Resolve the base (undiscounted) price for each of the given ticket
	 * types from the map resolve_unit_prices_for_event_date() returns.
	 * Mirrors resolve_unit_price()'s "only an explicit price row for the
	 * active period is purchasable" per-type selection rule as a pure,
	 * DB-free lookup, so a caller resolving many types reuses one bulk fetch
	 * instead of calling resolve_unit_price() (and re-querying) once per
	 * type. Unlike resolve_unit_price(), this does **not** run the price
	 * through the `fair_events_resolve_ticket_price` filter — matching the
	 * event-signup block's own existing bulk-fetch render path, which never
	 * applied that filter either. A caller that needs the filter applied
	 * (e.g. a single-item fallback that used to go through
	 * resolve_unit_price()) must apply it itself per type.
	 *
	 * @param int[]   $ticket_type_ids  Ticket type IDs to resolve.
	 * @param float[] $price_by_type_id Ticket-type ID => price for the active period.
	 * @return float[] Base price, keyed by ticket type ID; a type with no
	 *                 explicit price row for the active period is omitted
	 *                 (not purchasable right now), matching
	 *                 resolve_unit_price()'s null.
	 */
	public static function base_prices_for_types( array $ticket_type_ids, array $price_by_type_id ) {
		$base_price_by_type_id = array();

		foreach ( $ticket_type_ids as $ticket_type_id ) {
			$ticket_type_id = (int) $ticket_type_id;
			if ( array_key_exists( $ticket_type_id, $price_by_type_id ) ) {
				$base_price_by_type_id[ $ticket_type_id ] = (float) $price_by_type_id[ $ticket_type_id ];
			}
			// Else: no explicit price row for the active period → not purchasable, omitted.
		}

		return $base_price_by_type_id;
	}

	/**
	 * Keep only enabled ticket types actually purchasable right now under the
	 * currently active sale period. A type is purchasable only when it has an
	 * explicit price row for the active period ($price_by_type_id) — a blank
	 * price cell in the admin ticket editor is left unsaved and means "not on
	 * sale here", not "free" (issue #1624). Only call this when a sale period
	 * is actually active — the caller must drop everything itself when it
	 * isn't. Pure, DB-free — the caller resolves the price map first.
	 *
	 * @param object[] $ticket_types     Ticket type objects.
	 * @param float[]  $price_by_type_id Ticket-type ID => resolved price for the active period.
	 * @param string   $now              Current site datetime for deterministic tests. Defaults to current_time( 'mysql' ).
	 * @return object[] Purchasable ticket types, re-indexed.
	 */
	public static function filter_purchasable_types( array $ticket_types, array $price_by_type_id, $now = null ) {
		$now = $now ?? current_time( 'mysql' );

		return array_values(
			array_filter(
				$ticket_types,
				function ( $ticket_type ) use ( $price_by_type_id, $now ) {
					if ( ! self::is_ticket_type_enabled( $ticket_type, $now ) ) {
						return false;
					}
					return array_key_exists( (int) $ticket_type->id, $price_by_type_id );
				}
			)
		);
	}

	/**
	 * Check the ticket type's manual and scheduled enabled state.
	 *
	 * @param object $ticket_type Ticket type object.
	 * @param string $now         Current site datetime. Defaults to current_time( 'mysql' ).
	 * @return bool Whether the type remains enabled.
	 */
	public static function is_ticket_type_enabled( $ticket_type, $now = null ) {
		return TicketAvailability::is_ticket_type_enabled( $ticket_type, $now );
	}
}
