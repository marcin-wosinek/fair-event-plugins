<?php
/**
 * Group Signup Pricing Service
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\ParticipantRepository;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Pure presenter logic for group-restricted tiers and group discounts in the
 * unified Event Signup form, kept independent of the WordPress bootstrap
 * where possible so it stays unit-testable. Experimental-only lookups
 * (restrictions, memberships, discount rules) stay behind `class_exists()`
 * guards at each call site, degrading to "unrestricted, undiscounted" when
 * `fair-events-experimental` / `fair-audience-experimental` are inactive.
 */
class GroupSignupPricing {

	/**
	 * Resolve the viewer's fair-audience Participant from the session cookie
	 * or the logged-in WordPress user — the same identity lookup
	 * SignupHookBridge::enrich_render_context() already performs for pre-fill.
	 *
	 * @return \FairAudience\Models\Participant|null Participant, or null when anonymous/unknown.
	 */
	public static function resolve_viewer_participant() {
		$participant_repository = new ParticipantRepository();

		$participant_id = AudienceSession::get_participant_id();
		if ( $participant_id ) {
			return $participant_repository->get_by_id( $participant_id );
		}

		if ( get_current_user_id() ) {
			return $participant_repository->get_by_user_id( get_current_user_id() );
		}

		return null;
	}

	/**
	 * Filter a list of ticket types down to the ones the viewer may see:
	 * unrestricted types, plus restricted types the viewer belongs to a
	 * permitted group for.
	 *
	 * @param object[] $types             Ticket type objects (each with an `id` property).
	 * @param array    $restrictions_map  Associative array: ticket_type_id => int[] allowed group IDs
	 *                                    (as returned by TicketTypeGroupRestriction::get_all_by_event_date_id()).
	 * @param int[]    $member_group_ids  Group IDs the viewer belongs to (empty when anonymous/no groups).
	 * @return object[] Filtered ticket types, reindexed.
	 */
	public static function allowed_ticket_types( array $types, array $restrictions_map, array $member_group_ids ) {
		return array_values(
			array_filter(
				$types,
				function ( $type ) use ( $restrictions_map, $member_group_ids ) {
					$allowed_group_ids = $restrictions_map[ (int) $type->id ] ?? array();
					if ( empty( $allowed_group_ids ) ) {
						return true;
					}
					return ! empty( array_intersect( $allowed_group_ids, $member_group_ids ) );
				}
			)
		);
	}

	/**
	 * Check whether a ticket type is group-restricted and, if so, whether the
	 * given participant belongs to a permitted group. Mirrors
	 * EventSignupController::validate_ticket_type_group_restriction().
	 *
	 * @param int      $ticket_type_id Ticket type ID.
	 * @param int|null $participant_id fair-audience participant ID, or null for anonymous.
	 * @return WP_Error|null 403 `ticket_type_restricted` when disallowed, null when allowed
	 *                       (including when the experimental classes aren't active).
	 */
	public static function restriction_error( $ticket_type_id, $participant_id ) {
		if ( ! $ticket_type_id ) {
			return null;
		}

		if ( ! class_exists( \FairEventsExperimental\Models\TicketTypeGroupRestriction::class )
			|| ! class_exists( \FairAudienceExperimental\Database\GroupParticipantRepository::class ) ) {
			return null;
		}

		$allowed_group_ids = \FairEventsExperimental\Models\TicketTypeGroupRestriction::get_group_ids_by_ticket_type_id( $ticket_type_id );
		if ( empty( $allowed_group_ids ) ) {
			return null;
		}

		$member_group_ids = array();
		if ( $participant_id ) {
			$group_participant_repo = new \FairAudienceExperimental\Database\GroupParticipantRepository();
			$memberships            = $group_participant_repo->get_by_participant( $participant_id );
			$member_group_ids       = array_map(
				function ( $membership ) {
					return (int) $membership->group_id;
				},
				$memberships
			);
		}

		if ( empty( array_intersect( $allowed_group_ids, $member_group_ids ) ) ) {
			return new WP_Error(
				'ticket_type_restricted',
				__( 'This ticket type is not available for your account.', 'fair-audience' ),
				array( 'status' => 403 )
			);
		}

		return null;
	}

	/**
	 * Build the group discount note label, reusing the legacy render's
	 * strings verbatim so translation catalogs need no new entries.
	 *
	 * @param object $rule       Discount rule with `discount_type` ('percentage'|'amount')
	 *                           and `discount_value` properties (e.g. a GroupPricingRule).
	 * @param string $group_name Resolved group name (looked up by the caller, keeping this pure).
	 * @return string Formatted discount note.
	 */
	public static function discount_note_label( $rule, $group_name ) {
		if ( 'percentage' === $rule->discount_type ) {
			return sprintf(
				/* translators: 1: discount percentage, 2: group name */
				__( '%1$s%% discount applied (%2$s)', 'fair-audience' ),
				number_format_i18n( (float) $rule->discount_value ),
				$group_name
			);
		}

		return sprintf(
			/* translators: 1: discount amount, 2: group name */
			__( '%1$s discount applied (%2$s)', 'fair-audience' ),
			\FairEventsShared\Money::format_inline( (float) $rule->discount_value ),
			$group_name
		);
	}
}
