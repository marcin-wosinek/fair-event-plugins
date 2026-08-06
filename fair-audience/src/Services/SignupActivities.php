<?php
/**
 * Signup Activities Service
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\EventParticipantRepository;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Pure presenter/validation logic for selectable activities (ticket options)
 * in the unified Event Signup form, kept independent of the WordPress
 * bootstrap where possible so it stays unit-testable — mirrors
 * GroupSignupPricing from #1242. Experimental-only lookups (the option
 * catalogue, capacity, discount rules) stay behind `class_exists()` guards at
 * each call site, degrading to "no activities" when `fair-events-experimental`
 * is inactive.
 */
class SignupActivities {

	/**
	 * Compute the effective minimum number of activities a buyer must select:
	 * the event-date global baseline, possibly raised by the selected ticket
	 * type, capped at the number of options actually available so the
	 * requirement is never impossible to satisfy. Mirrors frontend.js'
	 * getEffectiveMinimum().
	 *
	 * @param int $option_count Number of activity options available.
	 * @param int $global_min   Event-date global minimum-activities setting.
	 * @param int $type_min     Selected ticket type's minimum_activities (0 = inherit global).
	 * @return int Effective minimum (0 = no requirement).
	 */
	public static function effective_minimum( $option_count, $global_min, $type_min ) {
		return min( (int) $option_count, max( (int) $global_min, (int) $type_min ) );
	}

	/**
	 * Whether a capacity-limited option has no seats left.
	 *
	 * @param int $reserved Active signups currently held against the option.
	 * @param int $capacity Configured capacity.
	 * @return bool True when full.
	 */
	public static function capacity_reached( $reserved, $capacity ) {
		return (int) $reserved >= (int) $capacity;
	}

	/**
	 * Apply a discount rule to a base price. Duplicates the small formula in
	 * `FairEventsExperimental\Services\EventSignupPricing::apply_discount()`
	 * rather than depending on that class here, so this stays testable
	 * without fair-events-experimental loaded.
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
	 * Resolve an activity option's price for the viewer, applying their best
	 * group discount rule (if any) on top of a positive base price. Mirrors
	 * the legacy render's `compute_option_price()`.
	 *
	 * @param float       $base_price    Base (undiscounted) option price.
	 * @param object|null $discount_rule Discount rule with `discount_type`/`discount_value`, or null.
	 * @return float Resolved price.
	 */
	public static function resolve_price( $base_price, $discount_rule ) {
		if ( ! $discount_rule || $base_price <= 0 ) {
			return $base_price;
		}
		return self::apply_discount( $base_price, $discount_rule->discount_type, (float) $discount_rule->discount_value );
	}

	/**
	 * Resolve an activity option's price for the viewer via the real-price
	 * group-discount resolver: each option is compared against its own base
	 * price, not one rule shared across the whole event date, so mixed
	 * percentage/amount rules pick the correct winner per option (issue
	 * #1297).
	 *
	 * @param float    $base_price            Base (undiscounted) option price.
	 * @param int      $pricing_event_date_id Event date the discount rules belong to.
	 * @param int|null $participant_id        Viewer's participant ID, or null for anonymous.
	 * @return float Resolved price.
	 */
	public static function resolve_price_for_participant( $base_price, $pricing_event_date_id, $participant_id ) {
		if ( ! $participant_id || $base_price <= 0 || ! class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
			return $base_price;
		}
		return \FairEventsExperimental\Services\EventSignupPricing::resolve_price_and_rule(
			(float) $base_price,
			$pricing_event_date_id,
			$participant_id
		)['price'];
	}

	/**
	 * Whether a raw TicketOption is full, based on its configured capacity.
	 *
	 * @param object                     $option Raw TicketOption row (needs `id`, `capacity`).
	 * @param EventParticipantRepository $repository Repository used to count active signups.
	 * @return bool True when full.
	 */
	public static function is_full( $option, EventParticipantRepository $repository ) {
		if ( null === $option->capacity ) {
			return false;
		}
		$reserved = $repository->count_signups_for_ticket_option( (int) $option->id );
		return self::capacity_reached( $reserved, (int) $option->capacity );
	}

	/**
	 * Resolve the effective minimum for a signup request: the event-date
	 * global setting, possibly raised by the given ticket type.
	 *
	 * @param int $pricing_event_date_id Event date the activity catalogue/settings belong to.
	 * @param int $ticket_type_id        Selected ticket type ID, or 0 for none.
	 * @param int $option_count          Number of activity options available.
	 * @return int Effective minimum.
	 */
	public static function effective_minimum_for_selection( $pricing_event_date_id, $ticket_type_id, $option_count ) {
		$global_min = class_exists( \FairEvents\Models\EventDateSetting::class )
			? (int) \FairEvents\Models\EventDateSetting::get( $pricing_event_date_id, 'minimum_activities' )
			: 0;

		$type_min = 0;
		if ( $ticket_type_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
			if ( $ticket_type ) {
				$type_min = (int) $ticket_type->minimum_activities;
			}
		}

		return self::effective_minimum( $option_count, $global_min, $type_min );
	}

	/**
	 * Validate a submitted activity selection: every ID must belong to the
	 * event date and not be full, and the selection must meet the effective
	 * minimum. Hooked on `fair_events_signup_options_error`.
	 *
	 * @param int[] $ticket_option_ids     Submitted option IDs.
	 * @param int   $pricing_event_date_id Event date the activity catalogue belongs to.
	 * @param int   $ticket_type_id        Selected ticket type ID, or 0 for none.
	 * @return WP_Error|null 400/409 on failure, null when the selection is valid.
	 */
	public static function validate_selection( array $ticket_option_ids, $pricing_event_date_id, $ticket_type_id ) {
		if ( ! class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
			// No activity catalogue active: a non-empty selection can't be valid.
			if ( empty( $ticket_option_ids ) ) {
				return null;
			}
			return new WP_Error(
				'invalid_ticket_option',
				__( 'One of the selected activities is not available for this event.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$available = \FairEventsExperimental\Models\TicketOption::get_all_by_event_date_id( $pricing_event_date_id );

		$available_by_id = array();
		foreach ( $available as $option ) {
			$available_by_id[ (int) $option->id ] = $option;
		}

		$repository = new EventParticipantRepository();

		foreach ( $ticket_option_ids as $option_id ) {
			$option = $available_by_id[ (int) $option_id ] ?? null;
			if ( ! $option ) {
				return new WP_Error(
					'invalid_ticket_option',
					__( 'One of the selected activities is not available for this event.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}
			if ( self::is_full( $option, $repository ) ) {
				return new WP_Error(
					'ticket_option_full',
					sprintf(
						/* translators: %s: activity name */
						__( '"%s" is full.', 'fair-audience' ),
						$option->name
					),
					array( 'status' => 409 )
				);
			}
		}

		$minimum = self::effective_minimum_for_selection( $pricing_event_date_id, $ticket_type_id, count( $available ) );
		if ( count( $ticket_option_ids ) < $minimum ) {
			return new WP_Error(
				'minimum_activities_not_met',
				sprintf(
					/* translators: %d: minimum number of activities required */
					_n(
						'Please select at least %d activity to sign up.',
						'Please select at least %d activities to sign up.',
						$minimum,
						'fair-audience'
					),
					$minimum
				),
				array( 'status' => 400 )
			);
		}

		return null;
	}

	/**
	 * Resolve priced line items for a submitted activity selection, applying
	 * each option's own best-matching group discount rule against its own
	 * real base price. Hooked on `fair_events_signup_option_line_items`.
	 * Assumes the selection was already validated by validate_selection() —
	 * an ID that no longer resolves is skipped rather than erroring.
	 *
	 * @param int[]    $ticket_option_ids     Submitted option IDs.
	 * @param int      $pricing_event_date_id Event date the activity catalogue belongs to.
	 * @param int|null $participant_id        Viewer's participant ID, or null for anonymous.
	 * @return array[] List of `[ 'name' => string, 'quantity' => 1, 'amount' => float ]`.
	 */
	public static function line_items( array $ticket_option_ids, $pricing_event_date_id, $participant_id ) {
		if ( empty( $ticket_option_ids ) || ! class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
			return array();
		}

		$line_items = array();
		foreach ( $ticket_option_ids as $option_id ) {
			$option = \FairEventsExperimental\Models\TicketOption::get_by_id( (int) $option_id );
			if ( ! $option ) {
				continue;
			}

			$base_price = class_exists( \FairEventsExperimental\Services\ActivityOptionPriceResolver::class )
				? \FairEventsExperimental\Services\ActivityOptionPriceResolver::resolve( $option )
				: (float) $option->price;
			if ( null === $base_price ) {
				continue;
			}

			$line_items[] = array(
				'name'     => $option->name,
				'quantity' => 1,
				'amount'   => self::resolve_price_for_participant( (float) $base_price, $pricing_event_date_id, $participant_id ),
			);
		}

		return $line_items;
	}

	/**
	 * Recompute `price`/`is_full` on the base-resolved `ticket_options`
	 * render-context entries for the viewer, and add `addable_options` /
	 * `current_activity_names` when the viewer is already signed up for this
	 * event date. Called from SignupHookBridge::enrich_render_context().
	 *
	 * @param array    $context        Render context from fair-events' base render.
	 * @param int|null $participant_id Viewer's participant ID, or null for anonymous.
	 * @return array Filtered context.
	 */
	public static function enrich_render_context( array $context, $participant_id ) {
		$context['addable_options']        = array();
		$context['current_activity_names'] = array();

		if ( empty( $context['ticket_options'] ) ) {
			return $context;
		}

		$pricing_event_date_id = (int) $context['pricing_event_date_id'];

		$event_participant_repository = new EventParticipantRepository();

		$signed_row = null;
		if ( $participant_id ) {
			$candidate = $event_participant_repository->get_by_event_date_and_participant(
				(int) $context['event_date_id'],
				$participant_id
			);
			if ( $candidate && 'signed_up' === $candidate->label ) {
				$signed_row = $candidate;
			}
		}

		$current_option_ids = $signed_row
			? $event_participant_repository->get_option_ids_for_event_participant( (int) $signed_row->id )
			: array();

		foreach ( $context['ticket_options'] as &$option ) {
			$option['price'] = self::resolve_price_for_participant( (float) $option['price'], $pricing_event_date_id, $participant_id );

			$is_full = false;
			if ( class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
				$raw_option = \FairEventsExperimental\Models\TicketOption::get_by_id( (int) $option['id'] );
				if ( $raw_option ) {
					$is_full = self::is_full( $raw_option, $event_participant_repository );
				}
			}
			$option['is_full'] = $is_full;

			if ( $signed_row ) {
				if ( in_array( (int) $option['id'], $current_option_ids, true ) ) {
					$context['current_activity_names'][] = $option['name'];
				} else {
					$context['addable_options'][] = $option;
				}
			}
		}
		unset( $option );

		return $context;
	}
}
