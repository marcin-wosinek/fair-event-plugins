<?php
/**
 * Instagram Connections Admin Page
 *
 * @package FairPlatform
 */

namespace FairPlatform\Admin;

defined( 'WPINC' ) || die;

/**
 * Instagram Connections page class
 */
class InstagramConnectionsPage {
	/**
	 * Render the Instagram connections page
	 *
	 * @return void
	 */
	public static function render() {
		// Check user capabilities.
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have sufficient permissions to access this page.', 'fair-platform' ) );
		}

		// Keep admin notices where core prints them. The deferred bundle can render
		// its heading first, and core then moves notices below that heading.
		?>
		<hr class="wp-header-end">
		<div class="wrap">
			<div id="fair-platform-instagram-connections-root"></div>
		</div>
		<?php
	}
}
