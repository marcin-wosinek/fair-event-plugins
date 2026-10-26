<?php
/**
 * Group Membership Support Service
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\TicketTypeGroupRestriction;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Whether group restrictions on ticket types can be verified right now.
 *
 * Restrictions are stored by Fair Events, but checking a viewer against them
 * needs Fair Audience (who the viewer is) and Fair Audience Experimental
 * (which groups they belong to). When either is missing a restricted tier
 * fails closed: it is hidden and direct requests for it are refused, so a
 * saved restriction never silently becomes a no-op (#1298). Fair Events
 * Experimental plays no part in this.
 */
class GroupMembershipSupport {

	/**
	 * Check whether membership of a restricted tier's groups can be verified.
	 * Evaluated at request time, so activating or deactivating a companion
	 * takes effect on the next request.
	 *
	 * @return bool True when both Fair Audience and Fair Audience Experimental are loaded.
	 */
	public static function is_available() {
		return class_exists( \FairAudience\Services\GroupSignupPricing::class )
			&& class_exists( \FairAudienceExperimental\Database\GroupParticipantRepository::class );
	}

	/**
	 * Refuse a group-restricted ticket type while membership can't be
	 * verified. Unrestricted types, and every type while membership support
	 * is available, pass through to the companion plugin's own check.
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @return WP_Error|null 403 `ticket_type_restricted` when refused, null otherwise.
	 */
	public static function unavailable_restriction_error( $ticket_type_id ) {
		if ( ! $ticket_type_id || self::is_available() ) {
			return null;
		}

		if ( empty( TicketTypeGroupRestriction::get_group_ids_by_ticket_type_id( $ticket_type_id ) ) ) {
			return null;
		}

		return new WP_Error(
			'ticket_type_restricted',
			__( 'This ticket type is not available for your account.', 'fair-events' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * Drop every group-restricted type from a list of ticket types.
	 *
	 * @param object[] $ticket_types          Ticket type objects (each with an `id` property).
	 * @param int      $pricing_event_date_id Event date the types are configured on.
	 * @return object[] Unrestricted ticket types, reindexed.
	 */
	public static function without_restricted_types( array $ticket_types, $pricing_event_date_id ) {
		if ( empty( $ticket_types ) ) {
			return $ticket_types;
		}

		$restrictions_map = TicketTypeGroupRestriction::get_all_by_event_date_id( $pricing_event_date_id );
		if ( empty( $restrictions_map ) ) {
			return $ticket_types;
		}

		return array_values(
			array_filter(
				$ticket_types,
				static function ( $type ) use ( $restrictions_map ) {
					return empty( $restrictions_map[ (int) $type->id ] ?? array() );
				}
			)
		);
	}
}
