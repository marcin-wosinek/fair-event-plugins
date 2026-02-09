<?php
/**
 * Image Templates Admin Page
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

defined( 'WPINC' ) || die;

/**
 * Image templates page wrapper.
 */
class ImageTemplatesPage {

	/**
	 * Render the page.
	 */
	public function render() {
		echo '<div id="fair-audience-image-templates-root"></div>';
	}
}
