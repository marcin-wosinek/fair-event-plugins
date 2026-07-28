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
		$ticket_type = TicketType::get_by_id( $ticket_type_id );
		if ( ! $ticket_type ) {
			return null;
		}

		$base_price = TicketPricing::resolve_unit_price( $ticket_type_id );
		if ( null === $base_price ) {
			return null;
		}

		if ( empty( $participant_id ) ) {
			return $base_price;
		}

		$rules = GroupPricingRule::get_all_by_event_date_id( $ticket_type->event_date_id );
		if ( empty( $rules ) || ! class_exists( \FairAudienceExperimental\Database\GroupParticipantRepository::class ) ) {
			return $base_price;
		}

		$group_repo = new \FairAudienceExperimental\Database\GroupParticipantRepository();
		$best_price = $base_price;

		foreach ( $rules as $rule ) {
			if ( ! $group_repo->get_by_group_and_participant( $rule->group_id, $participant_id ) ) {
				continue;
			}
			$candidate = self::apply_discount( $base_price, $rule->discount_type, (float) $rule->discount_value );
			if ( $candidate < $best_price ) {
				$best_price = $candidate;
			}
		}

		return $best_price;
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
	 * Resolve the best group discount rule for a participant on an event date.
	 *
	 * Returns the GroupPricingRule that yields the lowest price, or null
	 * when no discount applies.
	 *
	 * @param int      $event_date_id  Event date ID.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return GroupPricingRule|null Best matching rule, or null.
	 */
	public static function resolve_best_discount_rule( $event_date_id, $participant_id = null ) {
		if ( empty( $participant_id ) ) {
			return null;
		}

		$rules = GroupPricingRule::get_all_by_event_date_id( $event_date_id );
		if ( empty( $rules ) || ! class_exists( \FairAudienceExperimental\Database\GroupParticipantRepository::class ) ) {
			return null;
		}

		$group_repo = new \FairAudienceExperimental\Database\GroupParticipantRepository();
		$best_rule  = null;
		$best_price = PHP_FLOAT_MAX;

		foreach ( $rules as $rule ) {
			if ( ! $group_repo->get_by_group_and_participant( $rule->group_id, $participant_id ) ) {
				continue;
			}
			$candidate = self::apply_discount( 100.0, $rule->discount_type, (float) $rule->discount_value );
			if ( $candidate < $best_price ) {
				$best_price = $candidate;
				$best_rule  = $rule;
			}
		}

		return $best_rule;
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
