<?php
/**
 * Groups list admin page for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

defined( 'WPINC' ) || die;

/**
 * Handles the groups list admin page - React version
 */
class GroupsListPage {

	/**
	 * Render the groups list page
	 *
	 * @return void
	 */
	public function render() {
		?>
		<div id="fair-membership-groups-root"></div>
		<?php
	}
}