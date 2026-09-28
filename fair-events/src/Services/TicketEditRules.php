<?php
/**
 * Ticket Edit Rules Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventDates;
use FairEvents\Models\TicketType;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Rules an administrator's ticket-type or activity change must keep, shared
 * by the signup-wide edit (Lista) and the single-ticket edit (Fair
 * Audience's ticket endpoint).
 */
class TicketEditRules {

	/**
	 * The other ticket types a ticket of the given type can take: enabled
	 * types of the same event date or its series master, with the same
	 * recurrence scope.
	 *
	 * @param int        $event_date_id Event date the ticket is on.
	 * @param TicketType $current       The ticket's current type.
	 * @return TicketType[]
	 */
	public static function ticket_type_targets( int $event_date_id, $current ) {
		$event_date_ids = array_unique(
			array_filter(
				array(
					$event_date_id,
					(int) self::series_master_id( $event_date_id ),
				)
			)
		);

		$targets = array();
		foreach ( $event_date_ids as $id ) {
			foreach ( TicketType::get_all_by_event_date_id( $id ) as $ticket_type ) {
				if ( (int) $ticket_type->id !== (int) $current->id
					&& ! $ticket_type->disabled
					&& $ticket_type->recurrence_scope === $current->recurrence_scope
				) {
					$targets[] = $ticket_type;
				}
			}
		}

		return $targets;
	}

	/**
	 * Whether a ticket type lets its tickets hold activities.
	 *
	 * @param TicketType $ticket_type Ticket type.
	 * @return bool
	 */
	public static function activities_enabled( $ticket_type ) {
		return (bool) $ticket_type->activities_enabled && ! $ticket_type->is_multiple_instances();
	}

	/**
	 * Check that one ticket's activity count is one the ticket type allows:
	 * activities enabled at all, and within its minimum and maximum.
	 *
	 * @param TicketType|null $ticket_type Ticket type, or null for none (no rule).
	 * @param int             $count       Activities the ticket would hold.
	 * @return WP_Error|null
	 */
	public static function activity_count_error( $ticket_type, int $count ) {
		if ( ! $ticket_type ) {
			return null;
		}

		$enabled = self::activities_enabled( $ticket_type );

		if ( ! $enabled && $count > 0 ) {
			return new WP_Error(
				'ticket_type_activities_disabled',
				__( 'The chosen ticket type does not allow activities, and this ticket has some.', 'fair-events' ),
				array( 'status' => 409 )
			);
		}
		if ( $enabled && null !== $ticket_type->maximum_activities && $count > (int) $ticket_type->maximum_activities ) {
			return new WP_Error(
				'ticket_type_activities_exceeded',
				sprintf(
					/* translators: %d: maximum number of activities the ticket type allows */
					_n(
						'The chosen ticket type allows at most %d activity per ticket.',
						'The chosen ticket type allows at most %d activities per ticket.',
						(int) $ticket_type->maximum_activities,
						'fair-events'
					),
					(int) $ticket_type->maximum_activities
				),
				array( 'status' => 409 )
			);
		}
		if ( $enabled && $count < (int) $ticket_type->minimum_activities ) {
			return new WP_Error(
				'ticket_type_activities_missing',
				sprintf(
					/* translators: %d: minimum number of activities the ticket type requires */
					_n(
						'The chosen ticket type requires at least %d activity per ticket.',
						'The chosen ticket type requires at least %d activities per ticket.',
						(int) $ticket_type->minimum_activities,
						'fair-events'
					),
					(int) $ticket_type->minimum_activities
				),
				array( 'status' => 409 )
			);
		}

		return null;
	}

	/**
	 * The series master of an event date: itself when it is the master, its
	 * master when it is a generated occurrence, null otherwise.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int|null
	 */
	private static function series_master_id( int $event_date_id ) {
		$event_date = EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return null;
		}
		if ( 'generated' === $event_date->occurrence_type && $event_date->master_id ) {
			return (int) $event_date->master_id;
		}
		if ( 'master' === $event_date->occurrence_type ) {
			return (int) $event_date->id;
		}

		return null;
	}
}
