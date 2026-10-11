<?php
/**
 * Weekly Digest Page
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

defined( 'WPINC' ) || die;

/**
 * Weekly Digest admin page.
 *
 * The weekly email is managed in Fair Events → Event notifications, and
 * requests for this page are redirected there. It is rendered only while
 * Fair Events is inactive or too old to manage the email.
 */
class WeeklyDigestPage {
	/**
	 * Render page.
	 */
	public function render() {
		$message = class_exists( 'FairEvents\Core\Plugin' )
			? __( 'The weekly email is managed in Fair Events, under Event notifications. Update Fair Events to manage and send it; until then no weekly email is sent.', 'fair-audience' )
			: __( 'The weekly email is managed in Fair Events, under Event notifications. Fair Events is required: activate it to manage and send the weekly email. Your settings are kept, and nothing is sent while it is inactive.', 'fair-audience' );

		echo '<div class="wrap"><h1>' . esc_html__( 'Weekly Digest', 'fair-audience' ) . '</h1>';
		echo '<div class="notice notice-warning inline"><p>' . esc_html( $message ) . '</p></div></div>';
	}
}
