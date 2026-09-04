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
	 * Resolve the complete activity rule for a selected ticket type.
	 *
	 * @param int         $global_min  Type-less event minimum.
	 * @param object|null $ticket_type Selected ticket type, if any.
	 * @return array{enabled: bool, minimum: int, maximum: int|null}
	 */
	public static function selection_rule( $global_min, $ticket_type = null ) {
		if ( ! $ticket_type ) {
			return array(
				'enabled' => true,
				'minimum' => max( 0, (int) $global_min ),
				'maximum' => null,
			);
		}
		return array(
			'enabled' => ! empty( $ticket_type->activities_enabled ) && 'multiple_instances' !== ( $ticket_type->recurrence_scope ?? '' ),
			'minimum' => max( 0, (int) ( $ticket_type->minimum_activities ?? 0 ) ),
			'maximum' => isset( $ticket_type->maximum_activities ) ? max( 0, (int) $ticket_type->maximum_activities ) : null,
		);
	}

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
		if ( ! $participant_id || $base_price <= 0 ) {
			return $base_price;
		}
		return \FairAudience\Services\SignupPriceResolver::resolve_price_and_rule(
			(float) $base_price,
			$pricing_event_date_id,
			$participant_id
		)['price'];
	}

	/**
	 * Bulk counterpart to resolve_price_for_participant(): resolves several
	 * options' discounted prices in one call instead of once per option, so
	 * the event's discount rules and the viewer's group membership are each
	 * fetched once per render/request rather than once per option (issue
	 * #1299). Options with a zero/negative base price are left out of the
	 * lookup (nothing to discount) and pass through unchanged, mirroring
	 * resolve_price_for_participant()'s own guard.
	 *
	 * @param array<int, float> $base_price_by_option_id Base (undiscounted) option prices, keyed by option ID.
	 * @param int               $pricing_event_date_id  Event date the discount rules belong to.
	 * @param int|null          $participant_id          Viewer's participant ID, or null for anonymous.
	 * @return array<int, float> Resolved prices, keyed by option ID — same keys as the input.
	 */
	public static function resolve_prices_for_participant( array $base_price_by_option_id, $pricing_event_date_id, $participant_id ) {
		if ( ! $participant_id ) {
			return $base_price_by_option_id;
		}

		$discountable = array_filter(
			$base_price_by_option_id,
			static function ( $price ) {
				return $price > 0;
			}
		);

		$resolved_by_option_id = empty( $discountable )
			? array()
			: \FairAudience\Services\SignupPriceResolver::resolve_prices_and_rules( $pricing_event_date_id, $discountable, $participant_id );

		$prices = array();
		foreach ( $base_price_by_option_id as $option_id => $base_price ) {
			$prices[ $option_id ] = isset( $resolved_by_option_id[ $option_id ] )
				? $resolved_by_option_id[ $option_id ]['price']
				: $base_price;
		}

		return $prices;
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
	 * Resolve the effective minimum for a signup request. A selected ticket
	 * type is authoritative; the event-date value is only the type-less fallback.
	 *
	 * @param int $pricing_event_date_id Event date the activity catalogue/settings belong to.
	 * @param int $ticket_type_id        Selected ticket type ID, or 0 for none.
	 * @param int $option_count          Number of activity options available.
	 * @return int Effective minimum.
	 */
	public static function effective_minimum_for_selection( $pricing_event_date_id, $ticket_type_id, $option_count ) {
		unset( $option_count ); // Retained for backward-compatible callers of this public helper.
		$global_min = class_exists( \FairEvents\Models\EventDateSetting::class )
			? (int) \FairEvents\Models\EventDateSetting::get( $pricing_event_date_id, 'minimum_activities' )
			: 0;

		if ( $ticket_type_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_type = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
			if ( $ticket_type ) {
				return (int) $ticket_type->minimum_activities;
			}
		}

		return (int) $global_min;
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

		$repository       = new EventParticipantRepository();
		$selectable_count = 0;
		foreach ( $available as $option ) {
			if ( ! self::is_full( $option, $repository ) ) {
				++$selectable_count;
			}
		}

		$ticket_type = $ticket_type_id && class_exists( \FairEvents\Models\TicketType::class )
			? \FairEvents\Models\TicketType::get_by_id( $ticket_type_id )
			: null;
		$global_min  = class_exists( \FairEvents\Models\EventDateSetting::class )
			? (int) \FairEvents\Models\EventDateSetting::get( $pricing_event_date_id, 'minimum_activities' )
			: 0;
		$rule        = self::selection_rule( $global_min, $ticket_type );
		$enabled     = $rule['enabled'];
		$minimum     = $rule['minimum'];
		$maximum     = $rule['maximum'];

		if ( ! $enabled && ! empty( $ticket_option_ids ) ) {
			return new WP_Error(
				'activities_disabled',
				__( 'Extensions are not available for the selected ticket type.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}
		if ( $enabled && $minimum > $selectable_count ) {
			return new WP_Error(
				'activity_minimum_unavailable',
				__( 'Signup is unavailable because too few extensions can currently be selected.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}
		if ( $enabled && null !== $maximum && count( $ticket_option_ids ) > $maximum ) {
			return new WP_Error(
				'maximum_activities_exceeded',
				sprintf(
					/* translators: %d: maximum number of extensions allowed */
					_n( 'Please select no more than %d extension.', 'Please select no more than %d extensions.', $maximum, 'fair-audience' ),
					$maximum
				),
				array( 'status' => 400 )
			);
		}

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

		if ( $enabled && count( $ticket_option_ids ) < $minimum ) {
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

		$name_by_option_id       = array();
		$base_price_by_option_id = array();
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

			$name_by_option_id[ (int) $option_id ]       = $option->name;
			$base_price_by_option_id[ (int) $option_id ] = (float) $base_price;
		}

		// One bulk call resolves every selected option's discount at once,
		// instead of re-fetching the event's rules and the participant's
		// group membership per option (issue #1299).
		$resolved_prices = self::resolve_prices_for_participant( $base_price_by_option_id, $pricing_event_date_id, $participant_id );

		$line_items = array();
		foreach ( $name_by_option_id as $option_id => $name ) {
			$line_items[] = array(
				'name'     => $name,
				'quantity' => 1,
				'amount'   => $resolved_prices[ $option_id ],
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

		$current_option_ids   = $signed_row
			? $event_participant_repository->get_option_ids_for_event_participant( (int) $signed_row->id )
			: array();
		$confirmed_option_ids = $signed_row
			? $event_participant_repository->get_confirmed_option_ids_for_event_participant( (int) $signed_row->id )
			: array();

		// One bulk call resolves every option's discount at once, instead of
		// re-fetching the event's rules and the participant's group
		// membership per option on every render (issue #1299).
		$base_price_by_option_id = array();
		foreach ( $context['ticket_options'] as $option ) {
			$base_price_by_option_id[ (int) $option['id'] ] = (float) $option['price'];
		}
		$resolved_prices = self::resolve_prices_for_participant( $base_price_by_option_id, $pricing_event_date_id, $participant_id );

		foreach ( $context['ticket_options'] as &$option ) {
			$option['price'] = $resolved_prices[ (int) $option['id'] ];

			$is_full = false;
			if ( class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
				$raw_option = \FairEventsExperimental\Models\TicketOption::get_by_id( (int) $option['id'] );
				if ( $raw_option ) {
					$is_full = self::is_full( $raw_option, $event_participant_repository );
				}
			}
			$option['is_full'] = $is_full;

			if ( $signed_row ) {
				if ( in_array( (int) $option['id'], $confirmed_option_ids, true ) ) {
					$context['current_activity_names'][] = $option['name'];
				} elseif ( ! in_array( (int) $option['id'], $current_option_ids, true ) ) {
					$context['addable_options'][] = $option;
				}
			}
		}
		unset( $option );

		return $context;
	}
}
