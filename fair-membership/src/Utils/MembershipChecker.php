<?php
/**
 * Membership checker utility for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Utils;

use FairMembership\Models\Membership;

defined( 'WPINC' ) || die;

/**
 * Utility class for checking membership status
 */
class MembershipChecker {

	/**
	 * Check if a user is a member of any of the specified groups
	 *
	 * @param int   $user_id User ID to check.
	 * @param array $group_ids Array of group IDs to check against.
	 * @return bool True if user is an active member of any group, false otherwise.
	 */
	public static function user_is_member_of_groups( $user_id, $group_ids ) {
		// Validate inputs.
		if ( empty( $user_id ) || empty( $group_ids ) || ! is_array( $group_ids ) ) {
			return false;
		}

		// Check each group.
		foreach ( $group_ids as $group_id ) {
			$membership = Membership::get_active_by_user_and_group( $user_id, $group_id );

			if ( $membership && $membership->is_active() ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Check if a user is a member of a specific group
	 *
	 * @param int $user_id User ID to check.
	 * @param int $group_id Group ID to check against.
	 * @return bool True if user is an active member of the group, false otherwise.
	 */
	public static function user_is_member_of_group( $user_id, $group_id ) {
		if ( empty( $user_id ) || empty( $group_id ) ) {
			return false;
		}

		$membership = Membership::get_active_by_user_and_group( $user_id, $group_id );

		return $membership && $membership->is_active();
	}

	/**
	 * Get all group IDs that a user is an active member of
	 *
	 * @param int $user_id User ID.
	 * @return array Array of group IDs.
	 */
	public static function get_user_group_ids( $user_id ) {
		if ( empty( $user_id ) ) {
			return array();
		}

		$memberships = Membership::get_by_user( $user_id );
		$group_ids   = array();

		foreach ( $memberships as $membership ) {
			if ( $membership->is_active() ) {
				$group_ids[] = $membership->group_id;
			}
		}

		return array_unique( $group_ids );
	}

	/**
	 * Get all active member user IDs for a specific group
	 *
	 * @param int $group_id Group ID.
	 * @return array Array of user IDs who are active members of the group.
	 */
	public static function get_group_member_ids( $group_id ) {
		if ( empty( $group_id ) ) {
			return array();
		}

		$memberships = Membership::get_active_by_group( $group_id );
		$user_ids    = array();

		foreach ( $memberships as $membership ) {
			if ( $membership->is_active() ) {
				$user_ids[] = $membership->user_id;
			}
		}

		return array_unique( $user_ids );
	}
}
