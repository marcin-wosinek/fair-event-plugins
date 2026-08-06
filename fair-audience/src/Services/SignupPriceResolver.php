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
	 * Attempt a call into `FairEventsExperimental\Services\EventSignupPricing`,
	 * degrading instead of fataling when the two plugins' interfaces have
	 * drifted out of sync (issue #1421): a `method_exists()` guard catches a
	 * build that's missing the method entirely (`class_exists()` alone would
	 * stay true and the call would fatal with "Call to undefined method"),
	 * and a `try`/`catch` around the actual call additionally catches a build
	 * whose method exists but takes an incompatible signature (e.g. a new
	 * required parameter), which `method_exists()` can't detect on its own.
	 *
	 * @param string $method Method name on EventSignupPricing.
	 * @param array  $args   Positional arguments to call it with.
	 * @return array{ok: bool, value: mixed} `ok: true` with the real result,
	 *                                       or `ok: false` for the caller to
	 *                                       apply its own fallback.
	 */
	private static function call_experimental( $method, array $args ) {
		$class = \FairEventsExperimental\Services\EventSignupPricing::class;

		if ( method_exists( $class, $method ) ) {
			try {
				return array(
					'ok'    => true,
					'value' => call_user_func_array( array( $class, $method ), $args ),
				);
			} catch ( \Throwable $e ) { // phpcs:ignore Generic.CodeAnalysis.EmptyStatement.DetectedCatch -- intentional: version mismatch despite the method existing (e.g. an incompatible signature); fall through to the warning and let the caller apply its fallback.
				unset( $e );
			}
		}

		if ( class_exists( $class ) && defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( "FairAudience: fair-events-experimental's EventSignupPricing::{$method}() is missing or incompatible (version mismatch); falling back." );
		}

		return array(
			'ok'    => false,
			'value' => null,
		);
	}

	/**
	 * Resolve the effective price for a specific ticket type.
	 *
	 * @param int      $ticket_type_id Ticket type ID.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return float|null Final price, or null when not purchasable right now.
	 */
	public static function resolve_price_for_ticket_type( $ticket_type_id, $participant_id = null ) {
		$result = self::call_experimental( 'resolve_price_for_ticket_type', array( $ticket_type_id, $participant_id ) );
		if ( $result['ok'] ) {
			return $result['value'];
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
		$result = self::call_experimental( 'resolve_price_and_rule_for_ticket_type', array( $ticket_type_id, $participant_id ) );
		if ( $result['ok'] ) {
			return $result['value'];
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
	 * pricing) rather than a ticket type.
	 *
	 * @param float    $base_price     Base (undiscounted) price.
	 * @param int      $event_date_id  Event date ID the discount rules belong to.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return array{price: float, rule: object|null} Resolved price and the rule that produced it.
	 */
	public static function resolve_price_and_rule( $base_price, $event_date_id, $participant_id = null ) {
		$result = self::call_experimental( 'resolve_price_and_rule', array( $base_price, $event_date_id, $participant_id ) );
		if ( $result['ok'] ) {
			return $result['value'];
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
