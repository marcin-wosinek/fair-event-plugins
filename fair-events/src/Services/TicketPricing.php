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
