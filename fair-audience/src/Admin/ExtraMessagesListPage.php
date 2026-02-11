<?php
/**
 * Extra Messages List Admin Page
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

defined( 'WPINC' ) || die;

/**
 * Extra messages list page wrapper.
 */
class ExtraMessagesListPage {

	/**
	 * Render the page.
	 */
	public function render() {
		echo '<div id="fair-audience-extra-messages-root"></div>';
	}
}
