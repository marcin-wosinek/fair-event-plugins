<?php
/**
 * Admin Hooks for Fair Platform
 *
 * @package FairPlatform
 */

namespace FairPlatform\Admin;

use FairPlatform\Admin\ConnectionsPage;
use FairPlatform\Admin\InstagramConnectionsPage;

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

		add_submenu_page(
			'fair-platform-settings',
			__( 'Connection Logs', 'fair-platform' ),
			__( 'Connections', 'fair-platform' ),
			'manage_options',
			'fair-platform-connections',
			array( $this, 'render_connections_page' )
		);

		add_submenu_page(
			'fair-platform-settings',
			__( 'Instagram Connections', 'fair-platform' ),
			__( 'Instagram', 'fair-platform' ),
			'manage_options',
			'fair-platform-instagram-connections',
			array( $this, 'render_instagram_connections_page' )
		);
	}

	/**
	 * Enqueue admin styles
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_styles( $hook ) {
		$allowed_hooks = array(
			'toplevel_page_fair-platform-settings',
			'fair-platform_page_fair-platform-connections',
			'fair-platform_page_fair-platform-instagram-connections',
		);

		if ( ! in_array( $hook, $allowed_hooks, true ) ) {
			return;
		}

		wp_enqueue_style(
			'fair-platform-admin',
			\FAIR_PLATFORM_URL . 'assets/admin.css',
			array(),
			\FAIR_PLATFORM_VERSION
		);

		// Enqueue React admin page scripts for connections page.
		if ( 'fair-platform_page_fair-platform-connections' === $hook ) {
			$asset_file = \FAIR_PLATFORM_DIR . 'build/admin/connections/index.asset.php';

			if ( file_exists( $asset_file ) ) {
				$asset = include $asset_file;

				wp_enqueue_script(
					'fair-platform-connections',
					\FAIR_PLATFORM_URL . 'build/admin/connections/index.js',
					$asset['dependencies'],
					$asset['version'],
					true
				);

				wp_enqueue_style(
					'fair-platform-connections',
					\FAIR_PLATFORM_URL . 'build/admin/connections/index.css',
					array( 'wp-components' ),
					$asset['version']
				);
			}
		}

		// Enqueue React admin page scripts for Instagram connections page.
		if ( 'fair-platform_page_fair-platform-instagram-connections' === $hook ) {
			$asset_file = \FAIR_PLATFORM_DIR . 'build/admin/instagram-connections/index.asset.php';

			if ( file_exists( $asset_file ) ) {
				$asset = include $asset_file;

				wp_enqueue_script(
					'fair-platform-instagram-connections',
					\FAIR_PLATFORM_URL . 'build/admin/instagram-connections/index.js',
					$asset['dependencies'],
					$asset['version'],
					true
				);

				wp_enqueue_style(
					'fair-platform-instagram-connections',
					\FAIR_PLATFORM_URL . 'build/admin/instagram-connections/index.css',
					array( 'wp-components' ),
					$asset['version']
				);
			}
		}
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

	/**
	 * Render connections page
	 *
	 * @return void
	 */
	public function render_connections_page() {
		ConnectionsPage::render();
	}

	/**
	 * Render Instagram connections page
	 *
	 * @return void
	 */
	public function render_instagram_connections_page() {
		InstagramConnectionsPage::render();
	}
}
