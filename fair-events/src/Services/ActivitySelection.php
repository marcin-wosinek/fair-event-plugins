<?php
/**
 * Activity Selection Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventDateSetting;
use FairEvents\Models\TicketType;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Rules for the activities (ticket options) a buyer selects with a ticket:
 * which options can be offered right now, and whether a submitted selection
 * is valid. Shared by the signup render, its REST hydration, the get-tickets
 * purchase path and fair-audience's signup flows.
 */
class ActivitySelection {

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
	 * Whether a capacity-limited option has no place left on an occurrence.
	 *
	 * @param object $option        Activity option (needs id, capacity).
	 * @param int    $event_date_id Occurrence whose places are counted.
	 * @return bool True when full.
	 */
	public static function is_full( $option, $event_date_id ) {
		if ( null === $option->capacity ) {
			return false;
		}

		return TicketCapacity::count_ticket_option( (int) $option->id, (int) $event_date_id ) >= (int) $option->capacity;
	}

	/**
	 * The options that can be offered for an event date right now: those
	 * with a price for the current sale period, with that price, their
	 * translated display names and whether they are full. Options without a
	 * price right now are left out — they are unavailable, not free.
	 *
	 * @param int $pricing_event_date_id Event date the option catalogue belongs to.
	 * @param int $event_date_id         Occurrence whose places are counted.
	 * @return array[] Rows of [ id, name, short_name, price, is_full ], in display order.
	 */
	public static function offered_options( $pricing_event_date_id, $event_date_id ) {
		$resolved = ActivityOptionPriceResolver::resolve_for_event_date( (int) $pricing_event_date_id );

		$rows = array();
		foreach ( $resolved['options'] as $option_id => $option ) {
			$price = $resolved['price_by_option_id'][ $option_id ];
			if ( null === $price ) {
				continue;
			}

			$rows[] = array(
				'id'         => (int) $option_id,
				'name'       => ActivityOptionTranslation::translate_name( $option ),
				'short_name' => ActivityOptionTranslation::translate_short_name( $option ),
				'price'      => (float) $price,
				'is_full'    => self::is_full( $option, (int) $event_date_id ),
			);
		}

		return $rows;
	}

	/**
	 * Validate one ticket's submitted activity selection: every option must
	 * belong to the event date, have a price right now and a place left, and
	 * the selection must satisfy the ticket type's activity rule. Places
	 * across all tickets of a purchase are checked again under the capacity
	 * lock when it is saved.
	 *
	 * @param int[] $ticket_option_ids     Submitted option IDs.
	 * @param int   $pricing_event_date_id Event date the option catalogue belongs to.
	 * @param int   $ticket_type_id        Selected ticket type ID, or 0 for none.
	 * @param int   $event_date_id         Occurrence whose places are checked; 0 for the catalogue's own date.
	 * @return WP_Error|null 400/409 on failure, null when the selection is valid.
	 */
	public static function validate( array $ticket_option_ids, $pricing_event_date_id, $ticket_type_id, $event_date_id = 0 ) {
		$event_date_id = $event_date_id ? (int) $event_date_id : (int) $pricing_event_date_id;
		$resolved      = ActivityOptionPriceResolver::resolve_for_event_date( (int) $pricing_event_date_id );
		$options       = $resolved['options'];
		$prices        = $resolved['price_by_option_id'];

		$full_by_id       = array();
		$selectable_count = 0;
		foreach ( $options as $option_id => $option ) {
			$full_by_id[ $option_id ] = self::is_full( $option, $event_date_id );
			if ( null !== $prices[ $option_id ] && ! $full_by_id[ $option_id ] ) {
				++$selectable_count;
			}
		}

		$rule = self::selection_rule(
			(int) EventDateSetting::get( (int) $pricing_event_date_id, 'minimum_activities' ),
			$ticket_type_id ? TicketType::get_by_id( (int) $ticket_type_id ) : null
		);

		if ( ! $rule['enabled'] ) {
			if ( empty( $ticket_option_ids ) ) {
				return null;
			}
			return new WP_Error(
				'activities_disabled',
				__( 'Extensions are not available for the selected ticket type.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		if ( $rule['minimum'] > $selectable_count ) {
			return new WP_Error(
				'activity_minimum_unavailable',
				__( 'Signup is unavailable because too few extensions can currently be selected.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}

		if ( null !== $rule['maximum'] && count( $ticket_option_ids ) > $rule['maximum'] ) {
			return new WP_Error(
				'maximum_activities_exceeded',
				sprintf(
					/* translators: %d: maximum number of extensions allowed */
					_n( 'Please select no more than %d extension.', 'Please select no more than %d extensions.', $rule['maximum'], 'fair-events' ),
					$rule['maximum']
				),
				array( 'status' => 400 )
			);
		}

		foreach ( $ticket_option_ids as $option_id ) {
			$option = $options[ (int) $option_id ] ?? null;
			if ( ! $option ) {
				return new WP_Error(
					'invalid_ticket_option',
					__( 'One of the selected activities is not available for this event.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
			if ( null === $prices[ (int) $option_id ] ) {
				return new WP_Error(
					'ticket_option_unavailable',
					sprintf(
						/* translators: %s: activity name */
						__( '"%s" is not currently on sale. Reload the page and choose again.', 'fair-events' ),
						$option->name
					),
					array( 'status' => 409 )
				);
			}
			if ( $full_by_id[ (int) $option_id ] ) {
				return new WP_Error(
					'ticket_option_full',
					sprintf(
						/* translators: %s: activity name */
						__( '"%s" is full.', 'fair-events' ),
						$option->name
					),
					array( 'status' => 409 )
				);
			}
		}

		if ( count( $ticket_option_ids ) < $rule['minimum'] ) {
			return new WP_Error(
				'minimum_activities_not_met',
				sprintf(
					/* translators: %d: minimum number of activities required */
					_n(
						'Please select at least %d activity to sign up.',
						'Please select at least %d activities to sign up.',
						$rule['minimum'],
						'fair-events'
					),
					$rule['minimum']
				),
				array( 'status' => 400 )
			);
		}

		return null;
	}
}
