<?php
/**
 * Admin Hooks for Fair Platform
 *
 * @package FairPlatform
 */

namespace FairPlatform\Admin;

defined( 'WPINC' ) || die;

/**
 * Admin hooks class
 */
class AdminHooks {
	/**
	 * Initialize admin hooks
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_styles' ) );
	}

	/**
	 * Register admin menu
	 *
	 * @return void
	 */
	public function register_admin_menu() {
		add_menu_page(
			__( 'Fair Platform Settings', 'fair-platform' ),
			__( 'Fair Platform', 'fair-platform' ),
			'manage_options',
			'fair-platform-settings',
			array( $this, 'render_settings_page' ),
			'dashicons-admin-plugins',
			90
		);
	}

	/**
	 * Enqueue admin styles
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_styles( $hook ) {
		if ( 'toplevel_page_fair-platform-settings' !== $hook ) {
			return;
		}

		wp_enqueue_style(
			'fair-platform-admin',
			FAIR_PLATFORM_URL . 'assets/admin.css',
			array(),
			FAIR_PLATFORM_VERSION
		);
	}

	/**
	 * Render settings page
	 *
	 * @return void
	 */
	public function render_settings_page() {
		// Check user capabilities.
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have sufficient permissions to access this page.', 'fair-platform' ) );
		}

		$mollie_configured = defined( 'MOLLIE_CLIENT_ID' ) && defined( 'MOLLIE_CLIENT_SECRET' );
		$client_id         = $mollie_configured ? MOLLIE_CLIENT_ID : '';
		$has_secret        = $mollie_configured && ! empty( MOLLIE_CLIENT_SECRET );

		// Get recent transients for debugging.
		global $wpdb;
		$transients = $wpdb->get_results(
			"SELECT option_name, option_value
			FROM {$wpdb->options}
			WHERE option_name LIKE '_transient_mollie_oauth_%'
			ORDER BY option_id DESC
			LIMIT 10"
		);

		include __DIR__ . '/settings-page.php';
	}
}
