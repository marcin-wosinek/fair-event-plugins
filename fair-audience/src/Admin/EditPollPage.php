<?php
/**
 * Edit Poll Admin Page
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

defined( 'WPINC' ) || die;

/**
 * Edit poll page wrapper.
 */
class EditPollPage {

	/**
	 * Render the page.
	 */
	public function render() {
		echo '<div id="fair-audience-edit-poll-root"></div>';
	}
}
