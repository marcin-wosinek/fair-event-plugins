<?php
/**
 * One-off notice for sites whose stored Mollie API key was removed on upgrade
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Admin;

defined( 'WPINC' ) || die;

/**
 * Shows a one-off admin notice to sites whose stored Mollie API key was
 * deleted on upgrade (see Schema::migrate_to_v23()), pointing them at the
 * guided OAuth connection.
 */
class ApiKeyRemovedNotice {
	/**
	 * Option flag set by the v23 migration when a stored key was removed
	 * without an existing OAuth connection. Consumed (deleted) on first render
	 * so the notice shows exactly once rather than on every admin page load.
	 */
	const OPTION = 'fair_payment_api_key_removed_notice';

	/**
	 * Initialize the notice.
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_notices', array( $this, 'maybe_show_notice' ) );
	}

	/**
	 * Show the notice once, then consume the flag.
	 *
	 * @return void
	 */
	public function maybe_show_notice() {
		if ( ! is_admin() ) {
			return;
		}

		// Only show on Fair Event Plugins admin pages.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$current_page = isset( $_GET['page'] ) ? sanitize_text_field( wp_unslash( $_GET['page'] ) ) : '';
		if ( empty( $current_page ) || strpos( $current_page, 'fair' ) !== 0 ) {
			return;
		}

		if ( ! get_option( self::OPTION, false ) ) {
			return;
		}

		$this->render_notice();

		delete_option( self::OPTION );
	}

	/**
	 * Render the notice.
	 *
	 * @return void
	 */
	private function render_notice() {
		$settings_url = admin_url( 'admin.php?page=fair-payments-connector-settings' );

		$message = sprintf(
			'<strong>%1$s</strong> %2$s <a href="%3$s" class="button button-small" style="margin-left: 10px;">%4$s</a>',
			esc_html__( 'Fair Payments Connector:', 'fair-payments-connector' ),
			esc_html__( 'Your stored Mollie API key was removed. Complete the guided connection to keep accepting payments.', 'fair-payments-connector' ),
			esc_url( $settings_url ),
			esc_html__( 'Connect with Mollie', 'fair-payments-connector' )
		);

		wp_admin_notice(
			$message,
			array(
				'type'        => 'warning',
				'dismissible' => true,
			)
		);
	}
}
