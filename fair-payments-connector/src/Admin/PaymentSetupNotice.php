<?php
/**
 * Payment setup notice shown across Fair Event Plugins admin pages
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Admin;

use FairPaymentsConnector\Payment\MolliePaymentHandler;

defined( 'WPINC' ) || die;

/**
 * Shows a non-dismissible warning on Fair Event Plugins admin pages when
 * Fair Payments Connector is not ready to process real payments — either no
 * Mollie account is connected, or the connection is missing a profile ID or
 * still in test mode.
 */
class PaymentSetupNotice {

	/**
	 * Initialize the notice.
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_notices', array( $this, 'maybe_show_notice' ) );
	}

	/**
	 * Render the notice when the current admin page belongs to the Fair
	 * Event Plugins suite, the user can manage the payment settings, and the
	 * connector is not fully ready to process real payments.
	 *
	 * @return void
	 */
	public function maybe_show_notice() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		if ( ! self::is_suite_admin_page() ) {
			return;
		}

		$state = self::readiness_state();

		if ( 'ready' === $state ) {
			return;
		}

		$settings_url = add_query_arg( 'page', 'fair-payments-connector-settings', admin_url( 'admin.php' ) );

		if ( 'not_connected' === $state ) {
			/* translators: %s: link to the Fair Payments Connector settings page */
			$message = __( 'Fair Payments Connector is <strong>not connected to Mollie</strong> — paid flows cannot accept real payments until a Mollie account is connected. <a href="%s">Connect Mollie</a>.', 'fair-payments-connector' );
		} else {
			/* translators: %s: link to the Fair Payments Connector settings page */
			$message = __( 'Fair Payments Connector <strong>setup is incomplete</strong> — paid flows cannot accept real payments until setup is finished. <a href="%s">Finish setup</a>.', 'fair-payments-connector' );
		}

		$notice_message = sprintf(
			wp_kses(
				$message,
				array(
					'strong' => array(),
					'a'      => array( 'href' => array() ),
				)
			),
			esc_url( $settings_url )
		);

		wp_admin_notice(
			$notice_message,
			array(
				'type'        => 'warning',
				'dismissible' => false,
			)
		);
	}

	/**
	 * Determine payment readiness from stored settings, without a Mollie API
	 * request. Test mode never accepts real payments, so a connected profile
	 * that is still in test mode counts as incomplete, not ready.
	 *
	 * @return string One of 'not_connected', 'incomplete', 'ready'.
	 */
	public static function readiness_state() {
		if ( ! MolliePaymentHandler::is_configured() ) {
			return 'not_connected';
		}

		$profile_id = get_option( 'fair_payment_mollie_profile_id', '' );
		$mode       = get_option( 'fair_payment_mode', 'test' );

		if ( '' === $profile_id || 'live' !== $mode ) {
			return 'incomplete';
		}

		return 'ready';
	}

	/**
	 * Whether the current admin screen belongs to the Fair Event Plugins
	 * suite: a registered suite page (slug prefixed `fair-`, which covers
	 * every active plugin's pages, its hidden pages, and the shared
	 * Settings → Fair Event Plugins page) or a `fair_event` post-type screen
	 * (list table or editor). Ordinary WordPress admin pages, including
	 * editors for other post types Fair Events may be configured to treat as
	 * events, are excluded.
	 *
	 * @return bool
	 */
	public static function is_suite_admin_page() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$page = isset( $_GET['page'] ) ? sanitize_text_field( wp_unslash( $_GET['page'] ) ) : '';
		if ( '' !== $page && 0 === strpos( $page, 'fair-' ) ) {
			return true;
		}

		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;

		return $screen && 'fair_event' === $screen->post_type;
	}
}
