<?php
/**
 * Import Users page for Fair User Import
 *
 * @package FairUserImport
 */

namespace FairUserImport\Admin;

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
		<div id="fair-user-import-root"></div>
		<?php
	}
}
