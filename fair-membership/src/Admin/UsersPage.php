<?php
/**
 * Users page for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

defined( 'WPINC' ) || die;

/**
 * Users Page class for displaying all users
 */
class UsersPage {

	/**
	 * Render the users page
	 *
	 * @return void
	 */
	public function render() {
		?>
		<div id="fair-membership-users-root"></div>
		<?php
	}
}
