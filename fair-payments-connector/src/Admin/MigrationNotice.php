<?php
/**
 * Migration Notice for API Key to OAuth migration
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Admin;

defined( 'WPINC' ) || die;

/**
 * Displays admin notices to guide users migrating from API keys to OAuth
 */
class MigrationNotice {
	/**
	 * Initialize migration notice
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_notices', array( $this, 'show_migration_notice' ) );
	}

	/**
	 * Show migration notice to users with API keys but no OAuth connection
	 *
	 * @return void
	 */
	public function show_migration_notice() {
		// Only show on admin pages.
		if ( ! is_admin() ) {
			return;
		}

		// Only show on Fair Event Plugins admin pages.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$current_page = isset( $_GET['page'] ) ? sanitize_text_field( wp_unslash( $_GET['page'] ) ) : '';
		if ( empty( $current_page ) || strpos( $current_page, 'fair' ) !== 0 ) {
			return;
		}

		// Check if user has API keys configured.
		$has_api_keys = ! empty( get_option( 'fair_payment_test_api_key' ) ) ||
						! empty( get_option( 'fair_payment_live_api_key' ) );

		// Check if OAuth is connected.
		$has_oauth = get_option( 'fair_payment_mollie_connected', false );

		// Show notice only if API keys exist but OAuth is not connected.
		if ( $has_api_keys && ! $has_oauth ) {
			$this->render_migration_notice();
		}
	}

	/**
	 * Render the migration notice
	 *
	 * @return void
	 */
	private function render_migration_notice() {
		$settings_url = admin_url( 'admin.php?page=fair-payments-connector-settings' );

		$message = sprintf(
			'<strong>%1$s</strong> %2$s <a href="%3$s" class="button button-small" style="margin-left: 10px;">%4$s</a>',
			esc_html__( 'Fair Payments Connector:', 'fair-payments-connector' ),
			esc_html__( 'Please migrate to OAuth authentication.', 'fair-payments-connector' ),
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
