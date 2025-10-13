<?php
/**
 * Membership Matrix page for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

defined( 'WPINC' ) || die;

/**
 * Membership Matrix Page class for managing user-group memberships
 */
class MembershipMatrixPage {

	/**
	 * Render the membership matrix page
	 *
	 * @return void
	 */
	public function render() {
		?>
		<div id="fair-membership-matrix-root"></div>
		<?php
	}
}
