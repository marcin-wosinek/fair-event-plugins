<?php
/**
 * Import Users page for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

defined( 'WPINC' ) || die;

/**
 * Import Users Page class for bulk importing users with group assignments
 */
class ImportUsersPage {

	/**
	 * Render the import users page
	 *
	 * @return void
	 */
	public function render() {
		?>
		<div id="fair-membership-import-users-root"></div>
		<?php
	}
}
