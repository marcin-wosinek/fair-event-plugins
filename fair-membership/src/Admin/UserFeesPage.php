<?php
/**
 * User fees admin page for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

defined( 'WPINC' ) || die;

/**
 * Handles the user fees admin page - React version
 */
class UserFeesPage {

	/**
	 * Render the user fees page
	 *
	 * @return void
	 */
	public function render() {
		?>
		<div id="fair-membership-user-fees-root"></div>
		<?php
	}
}
