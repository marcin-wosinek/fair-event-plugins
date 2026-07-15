<?php
/**
 * Ticket Pricing Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

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
	 * Resolve the currently active sale period for an event date.
	 *
	 * Periods use a half-open day range [sale_start, sale_end) in the site
	 * timezone: sale_start is the first day on sale (00:00:00 site time) and
	 * sale_end is the first day no longer on sale (00:00:00 site time).
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

		return self::pick_active_period( $sale_periods, $now, true );
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
}
