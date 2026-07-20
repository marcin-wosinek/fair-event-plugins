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
use FairEvents\Models\TicketType;
use FairEvents\Services\SignupPricing;
use FairEvents\Services\TicketPricing;

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
		// Base price (including generated-occurrence → master inheritance,
		// already resolved by EventDates::hydrate()) lives in fair-events so
		// the base plugin combo doesn't need this experimental service.
		$base_price = SignupPricing::resolve_base_signup_price( $event_date_id );

		if ( null === $base_price ) {
			return null;
		}

		if ( empty( $participant_id ) ) {
			return $base_price;
		}

		$rules = GroupPricingRule::get_all_by_event_date_id( $event_date_id );
		if ( empty( $rules ) ) {
			return $base_price;
		}

		if ( ! class_exists( \FairAudienceExperimental\Database\GroupParticipantRepository::class ) ) {
			return $base_price;
		}

		$group_repo = new \FairAudienceExperimental\Database\GroupParticipantRepository();
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
	 * Resolve the sliding-scale (pay-what-you-can) config for an event date.
	 *
	 * Mirrors resolve_price()'s generated-occurrence → master inheritance:
	 * a generated occurrence with no signup_price of its own falls back to
	 * its master's signup_price and settings.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array{enabled:bool,min:float,max:float,suggested:float}|null
	 *               Config array, or null when sliding scale is off or the
	 *               event date doesn't exist.
	 */
	public static function resolve_sliding_scale( $event_date_id ) {
		$event_date = EventDates::get_by_id( $event_date_id );

		if ( ! $event_date ) {
			return null;
		}

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

		if ( '1' !== (string) EventDateSetting::get( $pricing_event_date_id, 'sliding_scale_enabled' ) ) {
			return null;
		}

		if ( null === $event_date->signup_price ) {
			return null;
		}

		return array(
			'enabled'   => true,
			'min'       => (float) EventDateSetting::get( $pricing_event_date_id, 'sliding_scale_min' ),
			'max'       => (float) EventDateSetting::get( $pricing_event_date_id, 'sliding_scale_max' ),
			'suggested' => (float) $event_date->signup_price,
		);
	}

	/**
	 * Clamp a buyer-chosen amount to the configured sliding-scale range.
	 *
	 * Never trust the client: this re-derives min/max/suggested from the
	 * database rather than accepting them as arguments. Falls back to the
	 * suggested price when sliding scale isn't configured or the chosen
	 * amount isn't a finite number.
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param float $chosen        Buyer-chosen amount.
	 * @return float Clamped amount.
	 */
	public static function clamp_chosen_amount( $event_date_id, $chosen ) {
		$config = self::resolve_sliding_scale( $event_date_id );

		if ( ! $config ) {
			return 0.0;
		}

		return self::clamp_amount_to_range( $chosen, $config['min'], $config['max'], $config['suggested'] );
	}

	/**
	 * Pure range-clamping math, split out from clamp_chosen_amount() for
	 * unit testing without a database.
	 *
	 * @param mixed $chosen    Buyer-chosen amount (may be non-numeric).
	 * @param float $min       Minimum allowed amount.
	 * @param float $max       Maximum allowed amount.
	 * @param float $suggested Fallback used when $chosen isn't a finite number.
	 * @return float Clamped amount.
	 */
	public static function clamp_amount_to_range( $chosen, $min, $max, $suggested ) {
		if ( ! is_numeric( $chosen ) || ! is_finite( (float) $chosen ) ) {
			$chosen = $suggested;
		}

		$chosen = (float) $chosen;

		if ( $chosen < $min ) {
			return $min;
		}
		if ( $chosen > $max ) {
			return $max;
		}
		return $chosen;
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
	 * Check whether a positive price is configured for an event date or ticket type,
	 * ignoring discount rules and sale-period timing.
	 *
	 * Used to determine if payment is *intended* even when the resolved price
	 * comes back as zero (e.g. because a discount rule brings it to zero or the
	 * pricing service was unavailable during resolution).
	 *
	 * Returns false when:
	 * - No TicketPrice / signup_price row exists.
	 * - The configured base price is 0 (genuinely free event).
	 * - The event date doesn't exist.
	 *
	 * @param int      $event_date_id  Event date ID.
	 * @param int|null $ticket_type_id Ticket type ID, or null for event-date pricing.
	 * @return bool True when a price > 0 is configured.
	 */
	public static function has_paid_price_configured( int $event_date_id, ?int $ticket_type_id = null ): bool {
		return SignupPricing::has_paid_price_configured( $event_date_id, $ticket_type_id );
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
