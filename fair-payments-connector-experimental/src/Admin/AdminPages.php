<?php
/**
 * Admin Pages for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Admin;

defined( 'WPINC' ) || die;

/**
 * Registers admin submenus and enqueues their scripts.
 */
class AdminPages {
	/**
	 * Initialize admin pages
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_menu', array( $this, 'register_admin_pages' ), 11 );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_pages() {
		// API Tokens submenu under the fair-payments-connector menu.
		add_submenu_page(
			'fair-payments-connector-transactions',
			__( 'API Tokens', 'fair-payments-connector-experimental' ),
			__( 'API Tokens', 'fair-payments-connector-experimental' ),
			'manage_options',
			'fair-payments-connector-api-tokens',
			array( $this, 'render_api_tokens_page' )
		);

		// Connected Sites submenu under the fair-payments-connector menu.
		add_submenu_page(
			'fair-payments-connector-transactions',
			__( 'Connected Sites', 'fair-payments-connector-experimental' ),
			__( 'Connected Sites', 'fair-payments-connector-experimental' ),
			'manage_options',
			'fair-payments-connector-connected-sites',
			array( $this, 'render_connected_sites_page' )
		);

		// Notifications submenu under the fair-payments-connector menu.
		add_submenu_page(
			'fair-payments-connector-transactions',
			__( 'Notifications', 'fair-payments-connector-experimental' ),
			__( 'Notifications', 'fair-payments-connector-experimental' ),
			'manage_options',
			'fair-payments-connector-notifications',
			array( $this, 'render_notifications_page' )
		);
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		if ( false !== strpos( $hook, 'fair-payments-connector-api-tokens' ) ) {
			$this->enqueue_admin_page_script( 'api-tokens' );
			return;
		}

		if ( false !== strpos( $hook, 'fair-payments-connector-connected-sites' ) ) {
			$this->enqueue_admin_page_script( 'connected-sites' );
			return;
		}

		if ( false !== strpos( $hook, 'fair-payments-connector-notifications' ) ) {
			$this->enqueue_admin_page_script( 'notifications' );
			return;
		}
	}

	/**
	 * Enqueue script for an admin page
	 *
	 * @param string $page Page name (api-tokens, connected-sites).
	 * @return void
	 */
	private function enqueue_admin_page_script( $page ) {
		$asset_file_path = FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_DIR . 'build/admin/' . $page . '/index.asset.php';

		if ( ! file_exists( $asset_file_path ) ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( 'Fair Payments Connector Experimental: Asset file not found at ' . $asset_file_path );
			}
			return;
		}

		$asset_file = include $asset_file_path;

		wp_enqueue_script(
			'fair-payments-connector-experimental-' . $page,
			FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_URL . 'build/admin/' . $page . '/index.js',
			$asset_file['dependencies'],
			$asset_file['version'],
			true
		);

		wp_enqueue_style( 'wp-components' );

		$style_file_path = FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_DIR . 'build/admin/' . $page . '/style-index.css';

		if ( file_exists( $style_file_path ) ) {
			wp_enqueue_style(
				'fair-payments-connector-experimental-' . $page,
				FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_URL . 'build/admin/' . $page . '/style-index.css',
				array( 'wp-components' ),
				$asset_file['version']
			);
		}
	}

	/**
	 * Render API tokens page
	 *
	 * @return void
	 */
	public function render_api_tokens_page() {
		?>
		<div id="fair-payments-connector-api-tokens-root"></div>
		<?php
	}

	/**
	 * Render connected sites page
	 *
	 * @return void
	 */
	public function render_connected_sites_page() {
		?>
		<div id="fair-payments-connector-connected-sites-root"></div>
		<?php
	}

	/**
	 * Render notifications settings page
	 *
	 * @return void
	 */
	public function render_notifications_page() {
		?>
		<div id="fair-payments-connector-experimental-notifications-root"></div>
		<?php
	}
}
