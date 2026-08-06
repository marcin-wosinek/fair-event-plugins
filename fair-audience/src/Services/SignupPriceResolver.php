<?php
/**
 * Signup Price Resolver
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Single seam fair-audience's signup flow uses to reach ticket-type pricing:
 * prefers the full-featured `FairEventsExperimental\Services\EventSignupPricing`
 * when the experimental plugin is active, and otherwise falls back to the
 * base resolution that lives in fair-events proper
 * (`FairEvents\Services\SignupPricing` / `TicketPricing`).
 *
 * Experimental-only pricing (group discounts, activity options) stays behind
 * its own `class_exists` guards at each call site — those already degrade to
 * null/no-op, never to free, so they don't need a facade.
 */
class SignupPriceResolver {

	/**
	 * Resolve the effective price for a specific ticket type.
	 *
	 * @param int      $ticket_type_id Ticket type ID.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return float|null Final price, or null when not purchasable right now.
	 */
	public static function resolve_price_for_ticket_type( $ticket_type_id, $participant_id = null ) {
		if ( class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
			return \FairEventsExperimental\Services\EventSignupPricing::resolve_price_for_ticket_type( $ticket_type_id, $participant_id );
		}

		if ( class_exists( \FairEvents\Services\TicketPricing::class ) ) {
			return \FairEvents\Services\TicketPricing::resolve_unit_price( $ticket_type_id );
		}

		return null;
	}

	/**
	 * Resolve the effective price for a specific ticket type, plus the
	 * group discount rule that produced it (if any). Mirrors
	 * resolve_price_for_ticket_type()'s fallback pattern: prefers the
	 * full-featured experimental resolver, and otherwise falls back to the
	 * base fair-events price with no rule (group discounts are
	 * experimental-only).
	 *
	 * @param int      $ticket_type_id Ticket type ID.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return array{price: float, rule: object|null}|null Null when not purchasable right now.
	 */
	public static function resolve_price_and_rule_for_ticket_type( $ticket_type_id, $participant_id = null ) {
		if ( class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
			return \FairEventsExperimental\Services\EventSignupPricing::resolve_price_and_rule_for_ticket_type( $ticket_type_id, $participant_id );
		}

		if ( class_exists( \FairEvents\Services\TicketPricing::class ) ) {
			$price = \FairEvents\Services\TicketPricing::resolve_unit_price( $ticket_type_id );
			return null === $price ? null : array(
				'price' => $price,
				'rule'  => null,
			);
		}

		return null;
	}

	/**
	 * Check whether a positive price is configured for a ticket type,
	 * ignoring discount rules and sale-period timing. Used by the
	 * fail-closed "payment unavailable" guard so a paid event never
	 * completes signup for free.
	 *
	 * @param int      $event_date_id  Event date ID.
	 * @param int|null $ticket_type_id Ticket type ID, or null for event-date pricing.
	 * @return bool True when a price > 0 is configured.
	 */
	public static function has_paid_price_configured( $event_date_id, $ticket_type_id = null ) {
		if ( class_exists( \FairEvents\Services\SignupPricing::class ) ) {
			return \FairEvents\Services\SignupPricing::has_paid_price_configured( $event_date_id, $ticket_type_id );
		}

		return false;
	}
}
