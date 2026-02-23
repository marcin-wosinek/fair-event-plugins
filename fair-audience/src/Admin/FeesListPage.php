<?php
/**
 * Fees List Page
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

defined( 'WPINC' ) || die;

/**
 * Fees list admin page.
 */
class FeesListPage {
	/**
	 * Render page.
	 */
	public function render() {
		echo '<div id="fair-audience-fees-list-root"></div>';
	}
}
