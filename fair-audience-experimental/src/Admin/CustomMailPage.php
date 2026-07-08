<?php
/**
 * Custom Mail Admin Page
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Admin;

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
