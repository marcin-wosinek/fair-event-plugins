<?php
/**
 * Polls List Admin Page
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

defined( 'WPINC' ) || die;

/**
 * Polls list page wrapper.
 */
class PollsListPage {

	/**
	 * Render the page.
	 */
	public function render() {
		echo '<div id="fair-audience-polls-root"></div>';
	}
}
