<?php
/**
 * Plugin Name: Fair Membership
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Membership management plugin.
 * Version: 0.3.0
 * Requires at least: 6.7
 * Requires PHP: 7.4
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-membership
 *
 * Fair Membership is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Fair Membership is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Fair Membership. If not, see https://www.gnu.org/licenses/gpl-3.0.html.
 *
 * @package FairMembership
 * @author Marcin Wosinek
 * @since 1.0.0
 */

namespace FairMembership {

	defined( 'WPINC' ) || die;
	require_once __DIR__ . '/vendor/autoload.php';

	use FairMembership\Core\Plugin;
	use FairMembership\Database\Installer;

	// Plugin activation hook.
	register_activation_hook( __FILE__, array( Installer::class, 'install' ) );

	// Plugin deactivation hook.
	register_deactivation_hook(
		__FILE__,
		function () {
			// Currently no deactivation tasks needed.
			error_log( 'Fair Membership: Plugin deactivated' );
		}
	);

	// Plugin uninstall is handled by uninstall.php.

	Plugin::instance()->init();
}

// Integration with fair-events user grouping system.
namespace {
	use FairMembership\Utils\MembershipChecker;
	use FairMembership\Models\Group;

	/**
	 * Register fair-membership group resolvers
	 *
	 * Handles format: fair-membership:{group_id}
	 * Example: fair-membership:5 (members of group ID 5)
	 */
	add_filter(
		'fair_events_user_group_resolve',
		function ( $user_ids, $group_string, $context ) {
			// Only handle fair-membership: format.
			if ( ! is_string( $group_string ) || strpos( $group_string, 'fair-membership:' ) !== 0 ) {
				return $user_ids;
			}

			// Parse format: fair-membership:{group_id}.
			if ( preg_match( '/^fair-membership:(\d+)$/', $group_string, $matches ) ) {
				$group_id = (int) $matches[1];

				// Get active members of this group.
				$user_ids = MembershipChecker::get_group_member_ids( $group_id );

				return array_map( 'intval', $user_ids );
			}

			return array();
		},
		10,
		3
	);

	/**
	 * Register fair-membership group options for UI
	 */
	add_filter(
		'fair_events_user_group_options',
		function ( $options ) {
			// Get all membership groups.
			$groups = Group::get_all();

			foreach ( $groups as $group ) {
				$options[] = array(
					'value'       => 'fair-membership:' . $group->id,
					'label'       => sprintf(
						/* translators: %s: Group name */
						__( '%s (Membership)', 'fair-membership' ),
						$group->name
					),
					'description' => __( 'Active members of this membership group', 'fair-membership' ),
				);
			}

			return $options;
		}
	);
}
