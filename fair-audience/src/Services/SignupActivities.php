<?php
/**
 * Signup Activities Service
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\EventParticipantRepository;

defined( 'WPINC' ) || die;

/**
 * Participant-specific layer over fair-events' activities (ticket options)
 * in the unified Event Signup form: group discounts on top of the base
 * prices fair-events resolves, and the signed-up viewer's own activities.
 * The option catalogue, base pricing and selection validation belong to
 * fair-events (`ActivityOptionPriceResolver`, `ActivitySelection`).
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
	 * Resolve several activity options' prices for the viewer in one call via
	 * the real-price group-discount resolver: each option is compared against
	 * its own base price, not one rule shared across the whole event date, so
	 * mixed percentage/amount rules pick the correct winner per option (issue
	 * #1297), and the event's discount rules and the viewer's group
	 * membership are each fetched once per render/request rather than once
	 * per option (issue #1299). Options with a zero/negative base price are
	 * left out of the lookup (nothing to discount) and pass through
	 * unchanged, as do all prices for an anonymous viewer.
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
	 * Apply the viewer's discounts to the `price` of the base-resolved
	 * `ticket_options` render-context entries (fair-events already resolved
	 * each one's availability and `is_full`), and add `addable_options` /
	 * `current_activity_names` when the viewer is already signed up for this
	 * event date, plus `addon_tickets` (id, label) when they hold several
	 * tickets there and must choose which one receives added activities. Called from SignupHookBridge::enrich_render_context().
	 *
	 * Only confirmed activities count as owned: one still awaiting payment
	 * (an abandoned, failed or expired checkout) stays addable so the viewer
	 * can come back and buy it (issue #1821).
	 *
	 * @param array    $context        Render context from fair-events' base render.
	 * @param int|null $participant_id Viewer's participant ID, or null for anonymous.
	 * @return array Filtered context.
	 */
	public static function enrich_render_context( array $context, $participant_id ) {
		$context['addable_options']        = array();
		$context['current_activity_names'] = array();
		$context['addon_tickets']          = array();

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

		// The viewer's own hold from an unfinished checkout already has its
		// place, so the activity stays selectable for them even when that
		// hold fills it.
		$now                  = gmdate( 'Y-m-d H:i:s' );
		$confirmed_option_ids = array();
		$own_held_ids         = array();
		foreach ( $signed_row ? $event_participant_repository->get_activity_rows( $signed_row ) : array() as $row ) {
			if ( 'confirmed' === $row->status ) {
				$confirmed_option_ids[] = (int) $row->ticket_option_id;
			} elseif ( ! empty( $row->expires_at ) && (string) $row->expires_at > $now ) {
				$own_held_ids[] = (int) $row->ticket_option_id;
			}
		}
		$owned_option_ids = $confirmed_option_ids;

		// Added activities go to one of the viewer's tickets. An activity is
		// addable while at least one of those tickets has not confirmed it;
		// with several tickets the viewer chooses which one receives it.
		$addon_tickets = $signed_row ? TicketActivities::addon_tickets( (int) $signed_row->event_date_id, (int) $participant_id ) : array();
		if ( $addon_tickets ) {
			$rows_by_ticket   = \FairEvents\Models\EventTicketActivity::get_by_ticket_ids( wp_list_pluck( $addon_tickets, 'id' ) );
			$owned_option_ids = null;
			foreach ( $addon_tickets as $position => $ticket ) {
				$confirmed = array();
				foreach ( $rows_by_ticket[ (int) $ticket->id ] ?? array() as $row ) {
					if ( 'confirmed' === $row->status ) {
						$confirmed[] = (int) $row->ticket_option_id;
					}
				}
				$owned_option_ids = null === $owned_option_ids ? $confirmed : array_values( array_intersect( $owned_option_ids, $confirmed ) );

				if ( count( $addon_tickets ) > 1 ) {
					$context['addon_tickets'][] = array(
						'id'    => (int) $ticket->id,
						'label' => TicketActivities::ticket_label( $ticket, $position + 1 ),
					);
				}
			}
		}

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

			if ( $signed_row ) {
				if ( in_array( (int) $option['id'], $confirmed_option_ids, true ) ) {
					$context['current_activity_names'][] = $option['name'];
				}
				// Confirmed on one ticket can still be addable to another.
				if ( ! in_array( (int) $option['id'], $owned_option_ids, true ) ) {
					$addable = $option;
					if ( in_array( (int) $option['id'], $own_held_ids, true ) ) {
						$addable['is_full'] = false;
					}
					$context['addable_options'][] = $addable;
				}
			}
		}
		unset( $option );

		return $context;
	}
}
