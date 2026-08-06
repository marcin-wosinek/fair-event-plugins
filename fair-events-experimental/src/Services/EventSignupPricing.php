<?php
/**
 * Event Signup Pricing Service
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

use FairEventsExperimental\Models\GroupPricingRule;
use FairEvents\Models\TicketType;
use FairEvents\Services\TicketPricing;

defined( 'WPINC' ) || die;

/**
 * Resolves the effective signup price for an event date, applying
 * per-group discounts for a given participant.
 */
class EventSignupPricing {

	/**
	 * Resolve the effective price for a specific ticket type.
	 *
	 * Looks up the currently-active sale period for the ticket type's
	 * event date, finds the matching TicketPrice row, then applies
	 * group discount rules. Returns null when no active sale period
	 * or no price row is configured.
	 *
	 * @param int      $ticket_type_id Ticket type ID.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return float|null Final price, or null when not purchasable right now.
	 */
	public static function resolve_price_for_ticket_type( $ticket_type_id, $participant_id = null ) {
		$resolved = self::resolve_price_and_rule_for_ticket_type( $ticket_type_id, $participant_id );
		return null === $resolved ? null : $resolved['price'];
	}

	/**
	 * Resolve the effective price for a specific ticket type, plus the
	 * group discount rule that produced it (if any). The single source of
	 * truth for both the charged price and the rule that explains it,
	 * closing the gap where a note could name a different rule than the one
	 * that actually won on the real price (issue #1297).
	 *
	 * @param int      $ticket_type_id Ticket type ID.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return array{price: float, rule: GroupPricingRule|null}|null Null when not purchasable right now.
	 */
	public static function resolve_price_and_rule_for_ticket_type( $ticket_type_id, $participant_id = null ) {
		$ticket_type = TicketType::get_by_id( $ticket_type_id );
		if ( ! $ticket_type ) {
			return null;
		}

		$base_price = TicketPricing::resolve_unit_price( $ticket_type_id );
		if ( null === $base_price ) {
			return null;
		}

		return self::resolve_price_and_rule( $base_price, $ticket_type->event_date_id, $participant_id );
	}

	/**
	 * Resolve the best group discount rule for a base price on an event
	 * date, and the price it produces. Compares every matching rule against
	 * the real `$base_price` — not a notional reference price — so a
	 * percentage rule and a fixed-amount rule are compared on equal footing
	 * for the price actually being charged (issue #1297). The returned rule
	 * is only set when it strictly reduced the price, so a free/€0 base
	 * price never comes back with a rule attached.
	 *
	 * @param float    $base_price     Base (undiscounted) price.
	 * @param int      $event_date_id  Event date ID the discount rules belong to.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return array{price: float, rule: GroupPricingRule|null} Resolved price and the rule that produced it.
	 */
	public static function resolve_price_and_rule( $base_price, $event_date_id, $participant_id = null ) {
		if ( empty( $participant_id ) ) {
			return array(
				'price' => $base_price,
				'rule'  => null,
			);
		}

		$rules = GroupPricingRule::get_all_by_event_date_id( $event_date_id );
		if ( empty( $rules ) || ! class_exists( \FairAudienceExperimental\Database\GroupParticipantRepository::class ) ) {
			return array(
				'price' => $base_price,
				'rule'  => null,
			);
		}

		$group_repo     = new \FairAudienceExperimental\Database\GroupParticipantRepository();
		$matching_rules = array();
		foreach ( $rules as $rule ) {
			if ( $group_repo->get_by_group_and_participant( $rule->group_id, $participant_id ) ) {
				$matching_rules[] = $rule;
			}
		}

		return self::best_rule_for_price( $base_price, $matching_rules );
	}

	/**
	 * Pick the discount rule that produces the lowest price for a given base
	 * price, out of a list of rules already known to match the participant
	 * (e.g. group membership already checked by the caller). Pure math, no DB
	 * access — the seam that makes the mixed percentage/amount comparison
	 * from issue #1297 unit-testable without a WordPress bootstrap. The
	 * returned rule is only set when it strictly reduced the price, so a
	 * free/€0 base price never comes back with a rule attached.
	 *
	 * @param float              $base_price     Base (undiscounted) price.
	 * @param GroupPricingRule[] $matching_rules Rules that already match the participant.
	 * @return array{price: float, rule: GroupPricingRule|null} Resolved price and the rule that produced it.
	 */
	public static function best_rule_for_price( $base_price, array $matching_rules ) {
		$best_price = $base_price;
		$best_rule  = null;

		foreach ( $matching_rules as $rule ) {
			$candidate = self::apply_discount( $base_price, $rule->discount_type, (float) $rule->discount_value );
			if ( $candidate < $best_price ) {
				$best_price = $candidate;
				$best_rule  = $rule;
			}
		}

		return array(
			'price' => $best_price,
			'rule'  => $best_rule,
		);
	}

	/**
	 * Resolve the currently active sale period for an event date.
	 *
	 * Delegates to the fair-events \FairEvents\Services\TicketPricing service,
	 * the canonical home of sale-period resolution (fair-events owns the
	 * pricing models).
	 *
	 * @param int $event_date_id Event date ID.
	 * @return \FairEvents\Models\TicketSalePeriod|null Active period or null.
	 */
	public static function resolve_active_sale_period( $event_date_id ) {
		return TicketPricing::resolve_active_sale_period( $event_date_id );
	}

	/**
	 * Apply a single discount rule to a base price.
	 *
	 * @param float  $base_price     Original price.
	 * @param string $discount_type  'percentage' or 'amount'.
	 * @param float  $discount_value Discount magnitude.
	 * @return float Discounted price (not clamped).
	 */
	public static function apply_discount( $base_price, $discount_type, $discount_value ) {
		if ( 'percentage' === $discount_type ) {
			return $base_price * ( 1.0 - ( $discount_value / 100.0 ) );
		}
		return $base_price - $discount_value;
	}
}
