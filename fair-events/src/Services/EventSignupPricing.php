<?php
/**
 * Event Signup Pricing Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventDates;
use FairEvents\Models\GroupPricingRule;
use FairEvents\Models\TicketType;
use FairEvents\Models\TicketSalePeriod;
use FairEvents\Models\TicketPrice;

defined( 'WPINC' ) || die;

/**
 * Resolves the effective signup price for an event date, applying
 * per-group discounts for a given participant.
 */
class EventSignupPricing {

	/**
	 * Resolve the effective signup price for a participant.
	 *
	 * Returns null when the event date has no signup price configured
	 * (i.e. legacy free signups). Returns a float >= 0 otherwise.
	 *
	 * @param int      $event_date_id  Event date ID.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return float|null Final price, or null when no price is configured.
	 */
	public static function resolve_price( $event_date_id, $participant_id = null ) {
		$event_date = EventDates::get_by_id( $event_date_id );

		if ( ! $event_date ) {
			return null;
		}

		// Generated occurrences do not store signup_price — inherit from master.
		$pricing_event_date_id = $event_date_id;
		if ( null === $event_date->signup_price
			&& 'generated' === $event_date->occurrence_type
			&& $event_date->master_id ) {
			$master = EventDates::get_by_id( $event_date->master_id );
			if ( $master && null !== $master->signup_price ) {
				$event_date            = $master;
				$pricing_event_date_id = $master->id;
			}
		}

		if ( null === $event_date->signup_price ) {
			return null;
		}

		$base_price = (float) $event_date->signup_price;

		if ( $base_price <= 0 || empty( $participant_id ) ) {
			return max( 0.0, $base_price );
		}

		$rules = GroupPricingRule::get_all_by_event_date_id( $pricing_event_date_id );
		if ( empty( $rules ) ) {
			return $base_price;
		}

		if ( ! class_exists( \FairAudience\Database\GroupParticipantRepository::class ) ) {
			return $base_price;
		}

		$group_repo = new \FairAudience\Database\GroupParticipantRepository();
		$best_price = $base_price;

		foreach ( $rules as $rule ) {
			$membership = $group_repo->get_by_group_and_participant( $rule->group_id, $participant_id );
			if ( ! $membership ) {
				continue;
			}

			$candidate = self::apply_discount( $base_price, $rule->discount_type, (float) $rule->discount_value );
			if ( $candidate < $best_price ) {
				$best_price = $candidate;
			}
		}

		return max( 0.0, $best_price );
	}

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

		$now           = current_time( 'mysql' );
		$sale_periods  = TicketSalePeriod::get_all_by_event_date_id( $ticket_type->event_date_id );
		$active_period = null;
		foreach ( $sale_periods as $period ) {
			if ( $period->sale_start <= $now && $period->sale_end >= $now ) {
				$active_period = $period;
				break;
			}
		}
		if ( ! $active_period ) {
			return null;
		}

		$price_row = TicketPrice::get_by_type_and_period( $ticket_type_id, $active_period->id );
		if ( ! $price_row ) {
			return null;
		}
		$base_price = (float) $price_row->price;

		if ( $base_price <= 0 || empty( $participant_id ) ) {
			return max( 0.0, $base_price );
		}

		$rules = GroupPricingRule::get_all_by_event_date_id( $ticket_type->event_date_id );
		if ( empty( $rules ) || ! class_exists( \FairAudience\Database\GroupParticipantRepository::class ) ) {
			return $base_price;
		}

		$group_repo = new \FairAudience\Database\GroupParticipantRepository();
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

		return max( 0.0, $best_price );
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
