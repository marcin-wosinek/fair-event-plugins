<?php
/**
 * Activity Option Price Resolver Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\TicketOption;
use FairEvents\Models\TicketOptionPrice;

defined( 'WPINC' ) || die;

/**
 * Resolves the effective base price of an activity option (TicketOption).
 *
 * When the option's `derive_price_from_sale_period` flag is off, the
 * stored `price` column wins (legacy behaviour). When the flag is on,
 * the price comes from the `TicketOptionPrice` row matching the active
 * sale period for the option's event date, using the same active-period
 * selection (and `continues_pricing_period` fallback) as ticket types.
 */
class ActivityOptionPriceResolver {

	/**
	 * Resolve the effective base price for an option.
	 *
	 * Returns null only in derived mode when there is no active period
	 * or no matching `TicketOptionPrice` row — i.e. the option is not
	 * purchasable right now (mirrors ticket-type behaviour). Callers
	 * that previously trusted a static price must handle null.
	 *
	 * Group discounts are NOT applied here; callers layer those on top
	 * via `EventSignupPricing::apply_discount()` as before.
	 *
	 * @param object $option Activity option (TicketOption-like, needs id, price, derive_price_from_sale_period, event_date_id).
	 * @return float|null
	 */
	public static function resolve( $option ) {
		if ( ! $option ) {
			return null;
		}

		if ( empty( $option->derive_price_from_sale_period ) ) {
			return isset( $option->price ) ? (float) $option->price : null;
		}

		$event_date_id = isset( $option->event_date_id ) ? (int) $option->event_date_id : 0;
		if ( ! $event_date_id ) {
			return null;
		}

		$active_period = EventSignupPricing::resolve_active_sale_period( $event_date_id );
		if ( ! $active_period ) {
			return null;
		}

		$price_row = TicketOptionPrice::get_by_option_and_period( (int) $option->id, (int) $active_period->id );
		if ( ! $price_row ) {
			return null;
		}

		return (float) $price_row->price;
	}
}
