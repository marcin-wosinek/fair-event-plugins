<?php
/**
 * Custom Mail Admin Page
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

defined( 'WPINC' ) || die;

/**
 * Custom mail page wrapper.
 */
class CustomMailPage {

	/**
	 * Render the page.
	 */
	public function render() {
		echo '<div id="fair-audience-custom-mail-root"></div>';
	}
}
