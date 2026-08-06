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
	 * Guards with `method_exists()`, not just `class_exists()`: if
	 * fair-events-experimental is active but stuck on a build that predates
	 * this method (a cross-plugin release gap — see issue #1421), the class
	 * still exists so `class_exists()` alone would stay true and the call
	 * would fatal with "Call to undefined method". Falls back to the base
	 * fair-events price instead.
	 *
	 * @param int      $ticket_type_id Ticket type ID.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return float|null Final price, or null when not purchasable right now.
	 */
	public static function resolve_price_for_ticket_type( $ticket_type_id, $participant_id = null ) {
		if ( method_exists( \FairEventsExperimental\Services\EventSignupPricing::class, 'resolve_price_for_ticket_type' ) ) {
			return \FairEventsExperimental\Services\EventSignupPricing::resolve_price_for_ticket_type( $ticket_type_id, $participant_id );
		}

		if ( class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'FairAudience: fair-events-experimental is missing EventSignupPricing::resolve_price_for_ticket_type() (version mismatch); falling back to base price.' );
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
	 * experimental-only). Guarded with `method_exists()` for the same
	 * version-skew reason (issue #1421).
	 *
	 * @param int      $ticket_type_id Ticket type ID.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return array{price: float, rule: object|null}|null Null when not purchasable right now.
	 */
	public static function resolve_price_and_rule_for_ticket_type( $ticket_type_id, $participant_id = null ) {
		if ( method_exists( \FairEventsExperimental\Services\EventSignupPricing::class, 'resolve_price_and_rule_for_ticket_type' ) ) {
			return \FairEventsExperimental\Services\EventSignupPricing::resolve_price_and_rule_for_ticket_type( $ticket_type_id, $participant_id );
		}

		if ( class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'FairAudience: fair-events-experimental is missing EventSignupPricing::resolve_price_and_rule_for_ticket_type() (version mismatch); falling back to base price with no rule.' );
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
	 * Resolve the best group discount rule for a base price on an event
	 * date, and the price it produces. Mirrors
	 * resolve_price_and_rule_for_ticket_type()'s fallback pattern, for
	 * call sites that already have a resolved base price (activity option
	 * pricing) rather than a ticket type. Guarded with `method_exists()`
	 * for the same version-skew reason (issue #1421).
	 *
	 * @param float    $base_price     Base (undiscounted) price.
	 * @param int      $event_date_id  Event date ID the discount rules belong to.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return array{price: float, rule: object|null} Resolved price and the rule that produced it.
	 */
	public static function resolve_price_and_rule( $base_price, $event_date_id, $participant_id = null ) {
		if ( method_exists( \FairEventsExperimental\Services\EventSignupPricing::class, 'resolve_price_and_rule' ) ) {
			return \FairEventsExperimental\Services\EventSignupPricing::resolve_price_and_rule( $base_price, $event_date_id, $participant_id );
		}

		if ( class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'FairAudience: fair-events-experimental is missing EventSignupPricing::resolve_price_and_rule() (version mismatch); falling back to base price with no rule.' );
		}

		return array(
			'price' => $base_price,
			'rule'  => null,
		);
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
