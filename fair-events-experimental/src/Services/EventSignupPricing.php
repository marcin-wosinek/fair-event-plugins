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
	 * Bulk counterpart to resolve_price_and_rule_for_ticket_type(): resolves
	 * every ticket type's price + winning discount rule for one event date in
	 * a single pass, instead of once per type. Where the single-item version
	 * re-resolves the active sale period, re-fetches the event's discount
	 * rules, and re-queries the participant's group membership per matching
	 * rule on every call, this fetches each exactly once and reuses them
	 * across every requested type — the query count no longer scales with the
	 * number of ticket types (issue #1299).
	 *
	 * @param int      $event_date_id  Event date ID.
	 * @param int[]    $ticket_type_ids Ticket type IDs to resolve, all belonging to $event_date_id.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return array<int, array{price: float, rule: GroupPricingRule|null}> Keyed by ticket type ID;
	 *         a type with no active-period price and no price row for any period is omitted
	 *         (not purchasable right now), matching resolve_price_for_ticket_type()'s null.
	 */
	public static function resolve_prices_and_rules_for_ticket_types( $event_date_id, array $ticket_type_ids, $participant_id = null ) {
		$resolved_prices       = TicketPricing::resolve_unit_prices_for_event_date( $event_date_id );
		$base_price_by_type_id = TicketPricing::base_prices_for_types(
			$ticket_type_ids,
			$resolved_prices['price_by_type_id'],
			$resolved_prices['priced_type_ids']
		);

		return self::resolve_prices_and_rules( $event_date_id, $base_price_by_type_id, $participant_id );
	}

	/**
	 * Bulk counterpart to resolve_price_and_rule(): resolves the winning
	 * discount rule for several already-known base prices on one event date
	 * — e.g. activity/ticket-option prices — fetching the event's discount
	 * rules and the participant's group membership once for the whole batch
	 * instead of once per price.
	 *
	 * @param int                      $event_date_id     Event date ID the discount rules belong to.
	 * @param array<int|string, float> $base_price_by_key Base (undiscounted) prices, keyed however the caller likes
	 *                                             (ticket type ID, ticket option ID, ...) — the same keys come back.
	 * @param int|null                 $participant_id    fair-audience participant ID, or null for anonymous.
	 * @return array<int|string, array{price: float, rule: GroupPricingRule|null}> Same keys as $base_price_by_key.
	 */
	public static function resolve_prices_and_rules( $event_date_id, array $base_price_by_key, $participant_id = null ) {
		$matching_rules = empty( $base_price_by_key )
			? array()
			: self::matching_rules_for_participant( $event_date_id, $participant_id );

		$result = array();
		foreach ( $base_price_by_key as $key => $base_price ) {
			$result[ $key ] = self::best_rule_for_price( $base_price, $matching_rules );
		}

		return $result;
	}

	/**
	 * Resolve the discount rules on an event date that the given participant
	 * actually matches, fetching the event's rules and the participant's full
	 * group-membership set exactly once each — the bulk counterpart to
	 * resolve_price_and_rule()'s per-rule get_by_group_and_participant() loop.
	 *
	 * @param int      $event_date_id  Event date ID the discount rules belong to.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return GroupPricingRule[] Rules the participant belongs to a matching group for.
	 */
	private static function matching_rules_for_participant( $event_date_id, $participant_id ) {
		if ( empty( $participant_id ) ) {
			return array();
		}

		$rules = GroupPricingRule::get_all_by_event_date_id( $event_date_id );
		if ( empty( $rules ) || ! class_exists( \FairAudienceExperimental\Database\GroupParticipantRepository::class ) ) {
			return array();
		}

		$group_repo       = new \FairAudienceExperimental\Database\GroupParticipantRepository();
		$memberships      = $group_repo->get_by_participant( $participant_id );
		$member_group_ids = array_map(
			static function ( $membership ) {
				return (int) $membership->group_id;
			},
			$memberships
		);

		return self::filter_matching_rules( $rules, $member_group_ids );
	}

	/**
	 * Keep only the rules a participant belonging to the given groups
	 * actually matches. Pure, DB-free — the seam that makes the bulk
	 * resolver's rule-matching unit-testable without a WordPress bootstrap,
	 * mirroring how best_rule_for_price() isolates the discount math below.
	 *
	 * @param GroupPricingRule[] $rules            Candidate rules for an event date.
	 * @param int[]              $member_group_ids Group IDs the participant belongs to.
	 * @return GroupPricingRule[] Rules whose group_id is in $member_group_ids.
	 */
	public static function filter_matching_rules( array $rules, array $member_group_ids ) {
		return array_values(
			array_filter(
				$rules,
				static function ( $rule ) use ( $member_group_ids ) {
					return in_array( (int) $rule->group_id, $member_group_ids, true );
				}
			)
		);
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
