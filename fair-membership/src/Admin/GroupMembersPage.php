<?php
/**
 * Group members admin page for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

defined( 'WPINC' ) || die;

/**
 * Handles the group members admin page - React version
 */
class GroupMembersPage {

	/**
	 * Render the group members page
	 *
	 * @return void
	 */
	public function render() {
		// Get group ID from query parameter
		$group_id = isset( $_GET['group_id'] ) ? absint( $_GET['group_id'] ) : 0;

		if ( ! $group_id ) {
			wp_die( esc_html__( 'Invalid group ID.', 'fair-membership' ) );
		}

		// Verify group exists
		$group = \FairMembership\Models\Group::get_by_id( $group_id );
		if ( ! $group ) {
			wp_die( esc_html__( 'Group not found.', 'fair-membership' ) );
		}

		?>
		<div id="fair-membership-group-members-root" data-group-id="<?php echo esc_attr( $group_id ); ?>"></div>
		<?php
	}
}
