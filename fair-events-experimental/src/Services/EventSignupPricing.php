<?php
/**
 * Event Signup Pricing Service
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

use FairEvents\Models\EventDates;
use FairEvents\Models\EventDateSetting;
use FairEventsExperimental\Models\GroupPricingRule;
use FairEventsExperimental\Models\TicketType;
use FairEventsExperimental\Models\TicketSalePeriod;
use FairEventsExperimental\Models\TicketPrice;
use FairEventsExperimental\Models\TicketOptionCollaborator;

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
	 * (i.e. legacy free signups). Returns a float otherwise (may be negative).
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

		if ( empty( $participant_id ) ) {
			return $base_price;
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

		return $best_price;
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

		$active_period = self::resolve_active_sale_period( $ticket_type->event_date_id );
		if ( ! $active_period ) {
			return null;
		}

		$price_row = TicketPrice::get_by_type_and_period( $ticket_type_id, $active_period->id );
		if ( ! $price_row ) {
			return null;
		}
		$base_price = (float) $price_row->price;

		if ( empty( $participant_id ) ) {
			return $base_price;
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

		return $best_price;
	}

	/**
	 * Resolve the currently active sale period for an event date.
	 *
	 * Matches the period whose [sale_start, sale_end] window covers
	 * "now". When no period matches and the per-event-date
	 * `continues_pricing_period` setting is on, falls back to the last
	 * period whose start is already in the past.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return TicketSalePeriod|null Active period or null.
	 */
	public static function resolve_active_sale_period( $event_date_id ) {
		$now           = current_time( 'mysql' );
		$sale_periods  = TicketSalePeriod::get_all_by_event_date_id( $event_date_id );
		$active_period = null;

		$continues  = class_exists( EventDateSetting::class )
			&& '1' === EventDateSetting::get( $event_date_id, 'continues_pricing_period' );
		$last_index = count( $sale_periods ) - 1;

		foreach ( $sale_periods as $index => $period ) {
			if ( $period->sale_start <= $now && $period->sale_end >= $now ) {
				return $period;
			}
			if ( $continues && $index === $last_index && $period->sale_start <= $now ) {
				$active_period = $period;
			}
		}

		return $active_period;
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
		if ( empty( $rules ) || ! class_exists( \FairAudience\Database\GroupParticipantRepository::class ) ) {
			return null;
		}

		$group_repo = new \FairAudience\Database\GroupParticipantRepository();
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

	/**
	 * Resolve the activity-collaborator discounted price for an option.
	 *
	 * Returns the option's discounted_price when:
	 * - the per-event-date setting `activity_collaborator_discount` is on,
	 * - the option has a non-null discounted_price,
	 * - and the given inviter participant is linked as a collaborator on that option.
	 *
	 * Returns null when the discount does not apply.
	 *
	 * @param object   $option                 TicketOption-like object exposing id and discounted_price.
	 * @param int      $event_date_id          Event date ID the option belongs to.
	 * @param int|null $inviter_participant_id Inviter participant ID resolved from a valid invitation token.
	 * @return float|null Discounted price if applicable, null otherwise.
	 */
	public static function resolve_option_invitation_price( $option, $event_date_id, $inviter_participant_id ) {
		if ( ! $inviter_participant_id || ! $option || ! $event_date_id ) {
			return null;
		}
		if ( ! isset( $option->discounted_price ) || null === $option->discounted_price ) {
			return null;
		}
		if ( '1' !== (string) EventDateSetting::get( (int) $event_date_id, 'activity_collaborator_discount' ) ) {
			return null;
		}

		$collaborator_ids = TicketOptionCollaborator::get_participant_ids_by_option_id( (int) $option->id );
		if ( ! in_array( (int) $inviter_participant_id, $collaborator_ids, true ) ) {
			return null;
		}

		return (float) $option->discounted_price;
	}
}
