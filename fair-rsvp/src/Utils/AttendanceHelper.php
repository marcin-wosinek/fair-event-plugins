<?php
/**
 * Attendance Permission Helper
 *
 * @package FairRsvp
 */

namespace FairRsvp\Utils;

defined( 'WPINC' ) || die;

/**
 * Helper class for resolving attendance permissions
 */
class AttendanceHelper {

	/**
	 * Get user's permission level for an event
	 *
	 * @param int   $user_id      User ID (0 for anonymous).
	 * @param bool  $is_logged_in Whether user is logged in.
	 * @param array $attendance   Attendance object from block attributes.
	 * @return int Permission level: 0=not allowed, 1=allowed, 2=expected.
	 */
	public static function get_user_permission( $user_id, $is_logged_in, $attendance ) {
		// Empty attendance = everyone allowed (backward compatible).
		if ( empty( $attendance ) || ! is_array( $attendance ) ) {
			return 1;
		}

		$max_permission = -1;

		if ( $is_logged_in && $user_id ) {
			// Check user's roles (most specific).
			$user = get_userdata( $user_id );
			if ( $user && ! empty( $user->roles ) ) {
				foreach ( $user->roles as $role ) {
					$role_key = 'role:' . $role;
					if ( isset( $attendance[ $role_key ] ) ) {
						$max_permission = max( $max_permission, (int) $attendance[ $role_key ] );
					}
				}
			}

			// Check "users" (all logged-in users).
			if ( isset( $attendance['users'] ) ) {
				$max_permission = max( $max_permission, (int) $attendance['users'] );
			}
		} else {
			// Check "anonymous" (not logged in).
			if ( isset( $attendance['anonymous'] ) ) {
				$max_permission = max( $max_permission, (int) $attendance['anonymous'] );
			}
		}

		// No match found = not allowed.
		return $max_permission >= 0 ? $max_permission : 0;
	}

	/**
	 * Check if user is allowed to RSVP
	 *
	 * @param int $permission Permission level from get_user_permission().
	 * @return bool True if allowed (1 or 2).
	 */
	public static function is_allowed( $permission ) {
		return $permission >= 1;
	}

	/**
	 * Check if user is expected/invited
	 *
	 * @param int $permission Permission level from get_user_permission().
	 * @return bool True if expected (2).
	 */
	public static function is_expected( $permission ) {
		return $permission >= 2;
	}
}
