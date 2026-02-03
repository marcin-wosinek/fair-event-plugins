<?php
/**
 * Instagram Posts Admin Page
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

defined( 'WPINC' ) || die;

/**
 * Instagram posts page wrapper.
 */
class InstagramPostsPage {

	/**
	 * Render the page.
	 */
	public function render() {
		echo '<div id="fair-audience-instagram-posts-root"></div>';
	}
}
