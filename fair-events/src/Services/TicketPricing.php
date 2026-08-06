<?php
/**
 * Ticket Pricing Service
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
 * Resolves ticket sale periods and prices for a ticket type. Single source
 * of truth shared by the fair-events get-tickets purchase paths and the
 * fair-events-experimental / fair-audience event-signup pricing service.
 */
class TicketPricing {

	/**
	 * Sentinel used as the effective sale_start for a period whose start is
	 * unset, so it always compares as "already started" against any real
	 * datetime string without special-casing the comparison in pick_active_period().
	 */
	const OPEN_START_SENTINEL = '0000-01-01 00:00:00';

	/**
	 * Resolve the currently active sale period for an event date.
	 *
	 * Periods use a half-open day range [sale_start, sale_end) in the site
	 * timezone: sale_start is the first day on sale (00:00:00 site time) and
	 * sale_end is the first day no longer on sale (00:00:00 site time).
	 *
	 * A period with an unset sale_start/sale_end is not "closed" — it
	 * resolves lazily: an open start (always on sale) and/or an end of the
	 * day after the event/series' last occurrence, computed fresh on every
	 * call so it automatically tracks series changes.
	 *
	 * Sale periods always chain: when no period matches, falls back to the
	 * last period whose start is already in the past.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return TicketSalePeriod|null Active period or null.
	 */
	public static function resolve_active_sale_period( $event_date_id ) {
		$now          = current_time( 'mysql' );
		$sale_periods = TicketSalePeriod::get_all_by_event_date_id( $event_date_id );

		$default_end  = self::compute_default_sale_end( EventDates::get_last_occurrence_end( $event_date_id ) );
		$sale_periods = self::apply_default_window( $sale_periods, $default_end );

		return self::pick_active_period( $sale_periods, $now, true );
	}

	/**
	 * Compute the lazy default sale_end: the day after the last occurrence,
	 * at 00:00:00 site time, preserving the half-open [start, end) range so
	 * the final day stays purchasable.
	 *
	 * @param string|null $last_occurrence_end Latest end_datetime across the event/series ('Y-m-d H:i:s'), or null.
	 * @return string|null Default sale_end ('Y-m-d H:i:s'), or null when there's no occurrence to anchor to.
	 */
	public static function compute_default_sale_end( $last_occurrence_end ) {
		if ( empty( $last_occurrence_end ) ) {
			return null;
		}

		$date = new \DateTime( $last_occurrence_end, wp_timezone() );
		$date->setTime( 0, 0, 0 );
		$date->modify( '+1 day' );

		return $date->format( 'Y-m-d H:i:s' );
	}

	/**
	 * Substitute the lazy default for any period with an unset sale_start
	 * and/or sale_end, without mutating the originals. Pure → unit-testable
	 * without a database.
	 *
	 * An unset sale_start becomes open (always already started). An unset
	 * sale_end becomes $default_end when one is available; otherwise it's
	 * left unset (pick_active_period() then never matches it as current, but
	 * the continues-fallback can still select it, same as any closed period).
	 *
	 * @param object[]    $periods     Sale periods with sale_start/sale_end strings, in sort order.
	 * @param string|null $default_end Lazy default sale_end ('Y-m-d H:i:s'), or null.
	 * @return object[] Periods with unset windows resolved; explicit values untouched.
	 */
	public static function apply_default_window( $periods, $default_end ) {
		$resolved = array();

		foreach ( $periods as $period ) {
			$resolved_period = clone $period;

			if ( empty( $resolved_period->sale_start ) ) {
				$resolved_period->sale_start = self::OPEN_START_SENTINEL;
			}

			if ( empty( $resolved_period->sale_end ) && $default_end ) {
				$resolved_period->sale_end = $default_end;
			}

			$resolved[] = $resolved_period;
		}

		return $resolved;
	}

	/**
	 * Pure period-selection math, split out from resolve_active_sale_period()
	 * for unit testing without a database.
	 *
	 * @param object[] $periods   Sale periods with sale_start/sale_end strings, in sort order.
	 * @param string   $now       Current datetime string ('Y-m-d H:i:s'), comparable lexically.
	 * @param bool     $continues Whether the continues_pricing_period fallback is enabled.
	 * @return object|null Active period, the fallback period, or null.
	 */
	public static function pick_active_period( $periods, $now, $continues ) {
		$active_period = null;
		$last_index    = count( $periods ) - 1;

		foreach ( $periods as $index => $period ) {
			// Half-open interval: sale_start <= now < sale_end.
			if ( $period->sale_start <= $now && $period->sale_end > $now ) {
				return $period;
			}
			if ( $continues && $index === $last_index && $period->sale_start <= $now ) {
				$active_period = $period;
			}
		}

		return $active_period;
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
		if ( ! $ticket_type ) {
			return null;
		}

		$active_period = self::resolve_active_sale_period( $ticket_type->event_date_id );
		if ( ! $active_period ) {
			return null;
		}

		$price_row = TicketPrice::get_by_type_and_period( $ticket_type_id, $active_period->id );
		if ( ! $price_row ) {
			// No row for this period. A type with no price row for ANY period
			// was never configured as paid — the admin ticket editor leaves a
			// blank price cell unsaved, so that's "free" by convention, not
			// "unpriced". A type priced for other periods but not this one is
			// a real paid type whose sale window lapsed, so it stays unavailable.
			return empty( TicketPrice::get_all_by_ticket_type_id( $ticket_type_id ) ) ? 0.0 : null;
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
	 *     price_by_type_id: float[],
	 *     priced_type_ids: int[]
	 * } `price_by_type_id` covers only types with a price row for the
	 *   active period; `priced_type_ids` lists every type with a price row
	 *   for *any* period, for filter_purchasable_types()'s "never priced is
	 *   free by convention" check.
	 */
	public static function resolve_unit_prices_for_event_date( $event_date_id ) {
		$active_period = self::resolve_active_sale_period( $event_date_id );
		if ( ! $active_period ) {
			return array(
				'active_period'    => null,
				'price_by_type_id' => array(),
				'priced_type_ids'  => array(),
			);
		}

		$price_by_type_id   = array();
		$priced_type_id_set = array();
		foreach ( TicketPrice::get_all_by_event_date_id( $event_date_id ) as $price_row ) {
			$priced_type_id_set[ (int) $price_row->ticket_type_id ] = true;
			if ( (int) $price_row->sale_period_id === (int) $active_period->id ) {
				$price_by_type_id[ (int) $price_row->ticket_type_id ] = (float) $price_row->price;
			}
		}

		return array(
			'active_period'    => $active_period,
			'price_by_type_id' => $price_by_type_id,
			'priced_type_ids'  => array_keys( $priced_type_id_set ),
		);
	}

	/**
	 * Resolve the base (undiscounted) price for each of the given ticket
	 * types from the maps resolve_unit_prices_for_event_date() returns.
	 * Mirrors resolve_unit_price()'s "never priced is free by convention,
	 * priced elsewhere is unavailable" per-type selection rule as a pure,
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
	 * @param int[]   $priced_type_ids  Ticket-type IDs with a price row for at least one period.
	 * @return float[] Base price, keyed by ticket type ID; a type priced for
	 *                 other periods but not the active one is omitted (not
	 *                 purchasable right now), matching resolve_unit_price()'s null.
	 */
	public static function base_prices_for_types( array $ticket_type_ids, array $price_by_type_id, array $priced_type_ids ) {
		$base_price_by_type_id = array();

		foreach ( $ticket_type_ids as $ticket_type_id ) {
			$ticket_type_id = (int) $ticket_type_id;
			if ( array_key_exists( $ticket_type_id, $price_by_type_id ) ) {
				$base_price_by_type_id[ $ticket_type_id ] = (float) $price_by_type_id[ $ticket_type_id ];
			} elseif ( ! in_array( $ticket_type_id, $priced_type_ids, true ) ) {
				$base_price_by_type_id[ $ticket_type_id ] = 0.0;
			}
			// Else: priced for other periods but not the active one → not purchasable, omitted.
		}

		return $base_price_by_type_id;
	}

	/**
	 * Keep only the ticket types actually purchasable right now under the
	 * currently active sale period. A type is purchasable when it either has
	 * a resolved price for the active period ($price_by_type_id), or has
	 * never had a price row for any period at all ($priced_type_ids) — free
	 * by convention, since the admin ticket editor leaves a blank price cell
	 * unsaved rather than writing a row. A type priced for other periods but
	 * not this one is a real paid type whose sale window lapsed, so it's
	 * dropped. Only call this when a sale period is actually active — the
	 * caller must drop everything itself when it isn't. Pure, DB-free — the
	 * caller resolves both maps first.
	 *
	 * @param object[] $ticket_types     Ticket type objects.
	 * @param float[]  $price_by_type_id Ticket-type ID => resolved price for the active period.
	 * @param int[]    $priced_type_ids  Ticket-type IDs with a price row for at least one period.
	 * @return object[] Purchasable ticket types, re-indexed.
	 */
	public static function filter_purchasable_types( array $ticket_types, array $price_by_type_id, array $priced_type_ids = array() ) {
		return array_values(
			array_filter(
				$ticket_types,
				function ( $ticket_type ) use ( $price_by_type_id, $priced_type_ids ) {
					$id = (int) $ticket_type->id;
					if ( array_key_exists( $id, $price_by_type_id ) ) {
						return true;
					}
					return ! in_array( $id, $priced_type_ids, true );
				}
			)
		);
	}
}
