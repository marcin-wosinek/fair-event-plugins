<?php
/**
 * Base Signup Pricing Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * Canonical home for base (non-experimental) signup pricing: the plain
 * per-date signup price and the "is this event actually paid" fail-closed
 * check. Group discounts, sliding scale, and invitation pricing stay in
 * FairEventsExperimental\Services\EventSignupPricing, which delegates its
 * base portions here so the two copies can't drift.
 *
 * Master → generated-occurrence inheritance for signup_price is already
 * resolved by EventDates::hydrate() (see EventDates::resolve_instance()),
 * so callers here always see the effective price without re-implementing
 * that lookup.
 */
class SignupPricing {

	/**
	 * Resolve the plain per-date signup price, with no discounts applied.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return float|null Signup price, or null when none is configured.
	 */
	public static function resolve_base_signup_price( int $event_date_id ): ?float {
		$event_date = EventDates::get_by_id( $event_date_id );

		if ( ! $event_date || null === $event_date->signup_price ) {
			return null;
		}

		return (float) $event_date->signup_price;
	}

	/**
	 * Check whether a positive price is configured for an event date or ticket
	 * type, ignoring discount rules and sale-period timing.
	 *
	 * Used to determine if payment is *intended* even when the resolved price
	 * comes back as zero (e.g. because a discount rule brings it to zero).
	 *
	 * @param int      $event_date_id  Event date ID.
	 * @param int|null $ticket_type_id Ticket type ID, or null for event-date pricing.
	 * @return bool True when a price > 0 is configured.
	 */
	public static function has_paid_price_configured( int $event_date_id, ?int $ticket_type_id = null ): bool {
		if ( $ticket_type_id ) {
			return self::is_price_positive( TicketPricing::resolve_unit_price( $ticket_type_id ) );
		}

		$event_date = EventDates::get_by_id( $event_date_id );

		if ( ! $event_date ) {
			return false;
		}

		return self::is_price_positive( $event_date->signup_price );
	}

	/**
	 * Pure "is this a positive price" check, split out for unit testing
	 * without a database.
	 *
	 * @param mixed $price Price value (may be null, int, float, or numeric string).
	 * @return bool True when the price is a positive number.
	 */
	public static function is_price_positive( $price ): bool {
		return null !== $price && (float) $price > 0;
	}
}
