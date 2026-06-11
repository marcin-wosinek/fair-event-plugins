<?php
/**
 * Admin Pages for Fair Payments Connector
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Admin;

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
		add_action( 'admin_notices', array( $this, 'render_test_mode_notice' ) );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_pages() {
		// Main transactions page.
		add_menu_page(
			__( 'Fair Payments Connector', 'fair-payments-connector' ),
			__( 'Fair Payments Connector', 'fair-payments-connector' ),
			'manage_options',
			'fair-payments-connector-transactions',
			array( $this, 'render_transactions_page' ),
			'dashicons-money-alt',
			'56'
		);

		// Transactions submenu (duplicate to rename main menu item).
		add_submenu_page(
			'fair-payments-connector-transactions',
			__( 'Transactions', 'fair-payments-connector' ),
			__( 'Transactions', 'fair-payments-connector' ),
			'manage_options',
			'fair-payments-connector-transactions'
		);

		// Hidden transaction detail page.
		$transaction_hookname = add_submenu_page(
			'',
			__( 'Transaction Detail', 'fair-payments-connector' ),
			__( 'Transaction Detail', 'fair-payments-connector' ),
			'manage_options',
			'fair-payments-connector-transaction',
			array( $this, 'render_transaction_page' )
		);

		// Set page title for hidden page to prevent strip_tags() deprecation warning.
		$this->set_hidden_page_title( $transaction_hookname, __( 'Transaction Detail', 'fair-payments-connector' ) );

		// Settings submenu.
		add_submenu_page(
			'fair-payments-connector-transactions',
			__( 'Settings', 'fair-payments-connector' ),
			__( 'Settings', 'fair-payments-connector' ),
			'manage_options',
			'fair-payments-connector-settings',
			array( $this, 'render_settings_page' )
		);

		// API Tokens submenu.
		add_submenu_page(
			'fair-payments-connector-transactions',
			__( 'API Tokens', 'fair-payments-connector' ),
			__( 'API Tokens', 'fair-payments-connector' ),
			'manage_options',
			'fair-payments-connector-api-tokens',
			array( $this, 'render_api_tokens_page' )
		);

		// Connected Sites submenu.
		add_submenu_page(
			'fair-payments-connector-transactions',
			__( 'Connected Sites', 'fair-payments-connector' ),
			__( 'Connected Sites', 'fair-payments-connector' ),
			'manage_options',
			'fair-payments-connector-connected-sites',
			array( $this, 'render_connected_sites_page' )
		);

		// Fee Dashboard submenu.
		add_submenu_page(
			'fair-payments-connector-transactions',
			__( 'Fee Dashboard', 'fair-payments-connector' ),
			__( 'Fee Dashboard', 'fair-payments-connector' ),
			'manage_options',
			'fair-payments-connector-fee-dashboard',
			array( $this, 'render_fee_dashboard_page' )
		);
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		// Transactions page.
		if ( 'toplevel_page_fair-payments-connector-transactions' === $hook ) {
			$this->enqueue_admin_page_script( 'transactions' );
			wp_localize_script(
				'fair-payments-connector-transactions',
				'fairPaymentTransactions',
				array(
					'organizationId' => get_option( 'fair_payment_organization_id', '' ),
					'testMode'       => 'test' === get_option( 'fair_payment_mode', 'test' ),
				)
			);
			return;
		}

		// Settings page.
		if ( false !== strpos( $hook, 'fair-payments-connector-settings' ) ) {
			$this->enqueue_admin_page_script( 'settings' );
			wp_localize_script(
				'fair-payments-connector-settings',
				'fairPaymentSettingsData',
				array(
					'features' => \FairPaymentsConnector\Core\Features::all(),
					'testMode' => 'test' === get_option( 'fair_payment_mode', 'test' ),
				)
			);
			return;
		}

		// API Tokens page.
		if ( false !== strpos( $hook, 'fair-payments-connector-api-tokens' ) ) {
			$this->enqueue_admin_page_script( 'api-tokens' );
			return;
		}

		// Connected Sites page.
		if ( false !== strpos( $hook, 'fair-payments-connector-connected-sites' ) ) {
			$this->enqueue_admin_page_script( 'connected-sites' );
			return;
		}

		// Fee Dashboard page.
		if ( false !== strpos( $hook, 'fair-payments-connector-fee-dashboard' ) ) {
			$this->enqueue_admin_page_script( 'fee-dashboard' );
			return;
		}

		// Transaction detail page.
		if ( 'admin_page_fair-payments-connector-transaction' === $hook ) {
			$this->enqueue_admin_page_script( 'transaction' );
			wp_localize_script(
				'fair-payments-connector-transaction',
				'fairPaymentTransactions',
				array(
					'organizationId' => get_option( 'fair_payment_organization_id', '' ),
				)
			);
			return;
		}
	}

	/**
	 * Render a non-dismissible warning notice on all admin pages when in test mode.
	 *
	 * @return void
	 */
	public function render_test_mode_notice() {
		if ( 'test' !== get_option( 'fair_payment_mode', 'test' ) ) {
			return;
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$settings_url = add_query_arg( 'page', 'fair-payments-connector-settings', admin_url( 'admin.php' ) );
		?>
		<div class="notice notice-warning">
			<p>
				<?php
				printf(
					wp_kses(
						/* translators: %s: link to settings page */
						__( 'Fair Payment is in <strong>Test mode</strong> — no real payments are being processed. <a href="%s">Switch to Live mode</a>.', 'fair-payments-connector' ),
						array(
							'strong' => array(),
							'a'      => array( 'href' => array() ),
						)
					),
					esc_url( $settings_url )
				);
				?>
			</p>
		</div>
		<?php
	}

	/**
	 * Set the page title for a hidden admin page.
	 *
	 * Hidden pages (registered with empty parent slug) are not in the submenu array,
	 * so WordPress cannot find their title. This causes $title to be null when
	 * admin-header.php calls strip_tags(), triggering a PHP 8.1+ deprecation warning.
	 *
	 * @param string $hookname The page hook name returned by add_submenu_page().
	 * @param string $page_title The title to set.
	 * @return void
	 */
	private function set_hidden_page_title( $hookname, $page_title ) {
		add_action(
			'load-' . $hookname,
			static function () use ( $page_title ) {
				global $title;
				// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
				$title = $page_title;
			}
		);
	}

	/**
	 * Enqueue script for an admin page
	 *
	 * @param string $page Page name (transactions, transaction, settings, api-tokens, connected-sites).
	 * @return void
	 */
	private function enqueue_admin_page_script( $page ) {
		$asset_file_path = FAIR_PAYMENTS_CONNECTOR_PLUGIN_DIR . 'build/admin/' . $page . '/index.asset.php';

		if ( ! file_exists( $asset_file_path ) ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( 'Fair Payments Connector: Asset file not found at ' . $asset_file_path );
			}
			return;
		}

		$asset_file = include $asset_file_path;

		wp_enqueue_script(
			'fair-payments-connector-' . $page,
			FAIR_PAYMENTS_CONNECTOR_PLUGIN_URL . 'build/admin/' . $page . '/index.js',
			$asset_file['dependencies'],
			$asset_file['version'],
			true
		);

		wp_enqueue_style( 'wp-components' );

		// Enqueue the page's stylesheet when one was emitted by the build.
		// wp-scripts writes style-index.css when index.js imports a stylesheet.
		$style_file_path = FAIR_PAYMENTS_CONNECTOR_PLUGIN_DIR . 'build/admin/' . $page . '/style-index.css';

		if ( file_exists( $style_file_path ) ) {
			wp_enqueue_style(
				'fair-payments-connector-' . $page,
				FAIR_PAYMENTS_CONNECTOR_PLUGIN_URL . 'build/admin/' . $page . '/style-index.css',
				array( 'wp-components' ),
				$asset_file['version']
			);
		}
	}

	/**
	 * Render settings page
	 *
	 * @return void
	 */
	public function render_settings_page() {
		?>
		<div id="fair-payments-connector-settings-root"></div>
		<?php
	}

	/**
	 * Render transaction detail page
	 *
	 * @return void
	 */
	public function render_transaction_page() {
		?>
		<div id="fair-payments-connector-transaction-root"></div>
		<?php
	}

	/**
	 * Render transactions page
	 *
	 * @return void
	 */
	public function render_transactions_page() {
		?>
		<div id="fair-payments-connector-transactions-root"></div>
		<?php
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
	 * Render fee dashboard page
	 *
	 * @return void
	 */
	public function render_fee_dashboard_page() {
		?>
		<div id="fair-payments-connector-fee-dashboard-root"></div>
		<?php
	}
}
