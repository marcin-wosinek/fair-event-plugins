<?php
/**
 * Base Signup Pricing Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * Canonical home for base (non-experimental) signup pricing: the "is this
 * event actually paid" fail-closed check. Group discounts and sliding scale
 * pricing stay in FairEventsExperimental\Services\EventSignupPricing, which
 * delegates its base portions here so the two copies can't drift.
 */
class SignupPricing {

	/**
	 * Check whether a positive price is configured for a ticket type,
	 * ignoring discount rules and sale-period timing.
	 *
	 * Used to determine if payment is *intended* even when the resolved price
	 * comes back as zero (e.g. because a discount rule brings it to zero).
	 *
	 * @param int      $event_date_id  Event date ID.
	 * @param int|null $ticket_type_id Ticket type ID, or null for event-date pricing.
	 * @return bool True when a price > 0 is configured.
	 */
	public static function has_paid_price_configured( int $event_date_id, ?int $ticket_type_id = null ): bool {
		if ( ! $ticket_type_id ) {
			return false;
		}

		return self::is_price_positive( TicketPricing::resolve_unit_price( $ticket_type_id ) );
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
