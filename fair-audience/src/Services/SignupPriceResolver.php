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
	 * Bulk counterpart to resolve_price_and_rule_for_ticket_type(): resolves
	 * every ticket type's price + winning discount rule for one event date in
	 * a single call, instead of once per type — the fix for the per-tier
	 * query multiplication in issue #1299. Callers looping over an event
	 * date's ticket types (the signup render, the purchase flow) should call
	 * this once instead of resolve_price_and_rule_for_ticket_type() per type.
	 *
	 * @param int      $event_date_id   Event date ID.
	 * @param int[]    $ticket_type_ids Ticket type IDs to resolve, all belonging to $event_date_id.
	 * @param int|null $participant_id  fair-audience participant ID, or null for anonymous.
	 * @return array<int, array{price: float, rule: object|null}> Keyed by ticket type ID;
	 *         a type not purchasable right now is omitted, matching resolve_price_and_rule_for_ticket_type()'s null.
	 */
	public static function resolve_prices_and_rules_for_ticket_types( $event_date_id, array $ticket_type_ids, $participant_id = null ) {
		$result = self::call_experimental( 'resolve_prices_and_rules_for_ticket_types', array( $event_date_id, $ticket_type_ids, $participant_id ) );
		if ( $result['ok'] ) {
			return $result['value'];
		}

		if ( ! class_exists( \FairEvents\Services\TicketPricing::class ) ) {
			return array();
		}

		$resolved_prices = \FairEvents\Services\TicketPricing::resolve_unit_prices_for_event_date( $event_date_id );

		// No active sale period at all → nothing is purchasable (matches
		// resolve_unit_price()'s null), not "every type is free" — an empty
		// price map alone can't distinguish that from a period being active
		// with nothing ever priced.
		if ( ! $resolved_prices['active_period'] ) {
			return array();
		}

		$base_price_by_type_id = \FairEvents\Services\TicketPricing::base_prices_for_types(
			$ticket_type_ids,
			$resolved_prices['price_by_type_id'],
			$resolved_prices['priced_type_ids']
		);

		$resolved = array();
		foreach ( $base_price_by_type_id as $ticket_type_id => $price ) {
			// Mirrors resolve_unit_price()'s own filter application — the
			// bulk helper this fallback is built on intentionally skips it
			// (see base_prices_for_types()' docblock), so apply it here per
			// type to keep this fallback's behaviour identical to the old
			// single-item resolve_price_and_rule_for_ticket_type() fallback.
			$resolved[ $ticket_type_id ] = array(
				'price' => (float) apply_filters(
					'fair_events_resolve_ticket_price',
					$price,
					$ticket_type_id,
					array(
						'event_date_id'  => $event_date_id,
						'sale_period_id' => $resolved_prices['active_period']->id,
					)
				),
				'rule'  => null,
			);
		}

		return $resolved;
	}

	/**
	 * Bulk counterpart to resolve_price_and_rule(): resolves the winning
	 * discount rule for several already-known base prices on one event date
	 * — e.g. activity/ticket-option prices — in a single call instead of once
	 * per price.
	 *
	 * @param int                      $event_date_id     Event date ID the discount rules belong to.
	 * @param array<int|string, float> $base_price_by_key Base (undiscounted) prices, keyed however the caller likes.
	 * @param int|null                 $participant_id    fair-audience participant ID, or null for anonymous.
	 * @return array<int|string, array{price: float, rule: object|null}> Same keys as $base_price_by_key.
	 */
	public static function resolve_prices_and_rules( $event_date_id, array $base_price_by_key, $participant_id = null ) {
		$result = self::call_experimental( 'resolve_prices_and_rules', array( $event_date_id, $base_price_by_key, $participant_id ) );
		if ( $result['ok'] ) {
			return $result['value'];
		}

		$resolved = array();
		foreach ( $base_price_by_key as $key => $base_price ) {
			$resolved[ $key ] = array(
				'price' => $base_price,
				'rule'  => null,
			);
		}

		return $resolved;
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
