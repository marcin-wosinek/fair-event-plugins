<?php
/**
 * Admin Pages for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Admin;

defined( 'WPINC' ) || die;

/**
 * Admin Pages class for registering admin menu pages
 */
class AdminPages {
	/**
	 * Initialize admin pages
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_menu', array( $this, 'register_admin_pages' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_pages() {
		// Main transactions page
		add_menu_page(
			__( 'Fair Payment', 'fair-payment' ),
			__( 'Fair Payment', 'fair-payment' ),
			'manage_options',
			'fair-payment-transactions',
			array( $this, 'render_transactions_page' ),
			'dashicons-money-alt',
			30
		);

		// Transactions submenu (duplicate to rename main menu item)
		add_submenu_page(
			'fair-payment-transactions',
			__( 'Transactions', 'fair-payment' ),
			__( 'Transactions', 'fair-payment' ),
			'manage_options',
			'fair-payment-transactions'
		);

		// Settings submenu
		add_submenu_page(
			'fair-payment-transactions',
			__( 'Settings', 'fair-payment' ),
			__( 'Settings', 'fair-payment' ),
			'manage_options',
			'fair-payment-settings',
			array( $this, 'render_settings_page' )
		);
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		// Enqueue settings page scripts.
		if ( false !== strpos( $hook, 'fair-payment-settings' ) ) {
			$asset_file_path = FAIR_PAYMENT_PLUGIN_DIR . 'build/admin/settings/index.asset.php';

			if ( ! file_exists( $asset_file_path ) ) {
				error_log( 'Fair Payment: Settings asset file not found at ' . $asset_file_path );
				return;
			}

			$asset_file = include $asset_file_path;

			wp_enqueue_script(
				'fair-payment-settings',
				FAIR_PAYMENT_PLUGIN_URL . 'build/admin/settings/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_enqueue_style( 'wp-components' );
		}

		// Enqueue transactions page scripts.
		if ( false !== strpos( $hook, 'fair-payment-transactions' ) ) {
			$asset_file_path = FAIR_PAYMENT_PLUGIN_DIR . 'build/admin/transactions/index.asset.php';

			if ( ! file_exists( $asset_file_path ) ) {
				error_log( 'Fair Payment: Transactions asset file not found at ' . $asset_file_path );
				return;
			}

			$asset_file = include $asset_file_path;

			wp_enqueue_script(
				'fair-payment-transactions',
				FAIR_PAYMENT_PLUGIN_URL . 'build/admin/transactions/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_enqueue_style( 'wp-components' );
		}
	}

	/**
	 * Render settings page
	 *
	 * @return void
	 */
	public function render_settings_page() {
		?>
		<div id="fair-payment-settings-root"></div>
		<?php
	}

	/**
	 * Render transactions page
	 *
	 * @return void
	 */
	public function render_transactions_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( __( 'You do not have sufficient permissions to access this page.', 'fair-payment' ) );
		}
		?>
		<div id="fair-payment-transactions-root"></div>
		<?php
	}
}
