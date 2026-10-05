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
 * Single source of truth shared by the signup render, its REST hydration,
 * the get-tickets purchase path and fair-audience's signup flows.
 *
 * When the option's `derive_price_from_sale_period` flag is off, the
 * stored `price` column wins. When the flag is on, the price comes from the
 * `TicketOptionPrice` row matching the active sale period for the option's
 * event date, using the same active-period selection as ticket types
 * ({@see TicketAvailability}).
 *
 * A null price means the option is not purchasable right now. It is never
 * free: only a stored zero price is.
 */
class ActivityOptionPriceResolver {

	/**
	 * Resolve the effective base price for an option.
	 *
	 * Returns null only in derived mode when there is no active period
	 * or no matching `TicketOptionPrice` row — i.e. the option is not
	 * purchasable right now (mirrors ticket-type behaviour).
	 *
	 * Participant discounts are NOT applied here; companion plugins layer
	 * those on top of this base price.
	 *
	 * @param object $option Activity option (TicketOption-like, needs id, price, derive_price_from_sale_period, event_date_id).
	 * @return float|null
	 */
	public static function resolve( $option ) {
		if ( ! $option ) {
			return null;
		}

		if ( empty( $option->derive_price_from_sale_period ) ) {
			return self::price_for_period( $option, null, array() );
		}

		$event_date_id = isset( $option->event_date_id ) ? (int) $option->event_date_id : 0;
		if ( ! $event_date_id ) {
			return null;
		}

		$active_period = TicketAvailability::resolve_active_sale_period( $event_date_id );
		if ( ! $active_period ) {
			return null;
		}

		$price_row = TicketOptionPrice::get_by_option_and_period( (int) $option->id, (int) $active_period->id );

		return self::price_for_period(
			$option,
			$active_period,
			$price_row ? array( (int) $active_period->id => (float) $price_row->price ) : array()
		);
	}

	/**
	 * Resolve the base price of every option configured for an event date in
	 * one pass — the bulk counterpart to resolve(), which re-resolves the
	 * active sale period and re-queries the price row for each option.
	 *
	 * @param int $event_date_id Event date the option catalogue belongs to.
	 * @return array{options: TicketOption[], price_by_option_id: array<int, float|null>}
	 *         `options` is keyed by option ID, in display order. A null price
	 *         marks an option that is not purchasable right now.
	 */
	public static function resolve_for_event_date( $event_date_id ) {
		$options = array();
		$derived = false;
		foreach ( TicketOption::get_all_by_event_date_id( (int) $event_date_id ) as $option ) {
			$options[ (int) $option->id ] = $option;
			$derived                      = $derived || ! empty( $option->derive_price_from_sale_period );
		}

		$active_period      = null;
		$prices_by_option   = array();
		$price_by_option_id = array();
		if ( $derived ) {
			$active_period = TicketAvailability::resolve_active_sale_period( (int) $event_date_id );
			foreach ( TicketOptionPrice::get_all_by_event_date_id( (int) $event_date_id ) as $price_row ) {
				$prices_by_option[ (int) $price_row->ticket_option_id ][ (int) $price_row->sale_period_id ] = (float) $price_row->price;
			}
		}

		foreach ( $options as $option_id => $option ) {
			$price_by_option_id[ $option_id ] = self::price_for_period( $option, $active_period, $prices_by_option[ $option_id ] ?? array() );
		}

		return array(
			'options'            => $options,
			'price_by_option_id' => $price_by_option_id,
		);
	}

	/**
	 * Pick an option's base price for the given active sale period. Pure,
	 * DB-free — the caller resolves the period and the option's price rows.
	 *
	 * @param object      $option             Activity option (needs price, derive_price_from_sale_period).
	 * @param object|null $active_period      Active sale period (needs id), or null when none is active.
	 * @param float[]     $price_by_period_id Sale-period ID => the option's price for that period.
	 * @return float|null Base price, or null when the option is not purchasable right now.
	 */
	public static function price_for_period( $option, $active_period, array $price_by_period_id ) {
		if ( empty( $option->derive_price_from_sale_period ) ) {
			return isset( $option->price ) ? (float) $option->price : null;
		}

		if ( ! $active_period || ! array_key_exists( (int) $active_period->id, $price_by_period_id ) ) {
			// No explicit price row for the active period → unavailable. Only
			// a stored zero price counts as free.
			return null;
		}

		return (float) $price_by_period_id[ (int) $active_period->id ];
	}

	/**
	 * Resolve the price a buyer is charged for each of the given options:
	 * the base price, with any participant discount a companion plugin
	 * layers on. Unavailable options (null base price) are left out of the
	 * discount step and come back null.
	 *
	 * @param array<int, float|null> $base_price_by_option_id Base prices, keyed by option ID.
	 * @param int                    $event_date_id           Event date the option catalogue belongs to.
	 * @param string                 $participant_token       Optional participant token sent with the request.
	 * @return array<int, float|null> Charged prices, same keys.
	 */
	public static function charged_prices( array $base_price_by_option_id, $event_date_id, $participant_token = '' ) {
		$available = array_filter(
			$base_price_by_option_id,
			static function ( $price ) {
				return null !== $price;
			}
		);

		/**
		 * Filters the prices charged for activity options, so a companion
		 * plugin (e.g. fair-audience group discounts) can lower them for a
		 * recognised participant. Fair Events builds the line items itself
		 * from the returned prices; a callback must return the same keys and
		 * never add charges of its own.
		 *
		 * @param array<int, float> $prices            Base prices, keyed by option ID.
		 * @param int               $event_date_id     Event date the option catalogue belongs to.
		 * @param string            $participant_token Optional participant token sent with the request.
		 */
		$filtered = (array) apply_filters( 'fair_events_signup_option_prices', $available, (int) $event_date_id, (string) $participant_token );

		$prices = array();
		foreach ( $base_price_by_option_id as $option_id => $base_price ) {
			$prices[ $option_id ] = null === $base_price
				? null
				: (float) ( $filtered[ $option_id ] ?? $base_price );
		}

		return $prices;
	}
}
