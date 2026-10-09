<?php
/**
 * Admin Pages for Fair Payments Connector
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Admin;

use FairPaymentsConnector\Core\ApiTokenOwnership;
use FairPaymentsConnector\Core\Features;
use FairPaymentsConnector\Core\NotificationOwnership;
use FairPaymentsConnector\Payment\MolliePaymentHandler;

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

		// After the experimental plugin's pages (priority 11), so Notifications
		// keeps its place at the end of the menu.
		add_action( 'admin_menu', array( $this, 'register_notifications_page' ), 12 );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
		add_filter( 'plugin_action_links_fair-payments-connector/fair-payments-connector.php', array( $this, 'add_plugin_action_links' ) );
		add_filter( 'removable_query_args', array( $this, 'keep_oauth_error_query_arg' ) );
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

		// External Updates submenu, right after Transactions.
		add_submenu_page(
			'fair-payments-connector-transactions',
			__( 'External Updates', 'fair-payments-connector' ),
			__( 'External Updates', 'fair-payments-connector' ),
			'manage_options',
			'fair-payments-connector-external-updates',
			array( $this, 'render_external_updates_page' ),
			5
		);

		// Fee Dashboard submenu (position 10 — gaps reserved for experimental plugin).
		add_submenu_page(
			'fair-payments-connector-transactions',
			__( 'Fee Dashboard', 'fair-payments-connector' ),
			__( 'Fee Dashboard', 'fair-payments-connector' ),
			'manage_options',
			'fair-payments-connector-fee-dashboard',
			array( $this, 'render_fee_dashboard_page' ),
			10
		);

		// Settings submenu (position 20 — gaps reserved for experimental plugin).
		add_submenu_page(
			'fair-payments-connector-transactions',
			__( 'Settings', 'fair-payments-connector' ),
			__( 'Settings', 'fair-payments-connector' ),
			'manage_options',
			'fair-payments-connector-settings',
			array( $this, 'render_settings_page' ),
			20
		);
	}

	/**
	 * Register the Notifications submenu while this plugin owns notifications.
	 *
	 * @return void
	 */
	public function register_notifications_page() {
		if ( ! NotificationOwnership::is_owner() ) {
			return;
		}

		add_submenu_page(
			'fair-payments-connector-transactions',
			__( 'Notifications', 'fair-payments-connector' ),
			__( 'Notifications', 'fair-payments-connector' ),
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
		// Transactions page.
		if ( 'toplevel_page_fair-payments-connector-transactions' === $hook ) {
			$this->enqueue_admin_page_script( 'transactions' );
			wp_localize_script(
				'fair-payments-connector-transactions',
				'fairPaymentTransactions',
				array(
					'organizationId'     => get_option( 'fair_payment_organization_id', '' ),
					'externalUpdatesUrl' => add_query_arg( 'page', 'fair-payments-connector-external-updates', admin_url( 'admin.php' ) ),
				)
			);
			return;
		}

		// External Updates page.
		if ( false !== strpos( $hook, 'fair-payments-connector-external-updates' ) ) {
			$this->enqueue_admin_page_script( 'external-updates' );
			wp_set_script_translations( 'fair-payments-connector-external-updates', 'fair-payments-connector', Features::script_translations_path() );
			wp_localize_script(
				'fair-payments-connector-external-updates',
				'fairPaymentsExternalUpdates',
				array(
					'testMode'          => 'test' === get_option( 'fair_payment_mode', 'test' ),
					'mollieConnected'   => (bool) get_option( 'fair_payment_mollie_connected', false ),
					'mollieSettingsUrl' => add_query_arg( 'page', 'fair-payments-connector-settings', admin_url( 'admin.php' ) ),
					'connectedSitesUrl' => add_query_arg( 'page', 'fair-payments-connector-connected-sites', admin_url( 'admin.php' ) ),
					'transactionsUrl'   => add_query_arg( 'page', 'fair-payments-connector-transactions', admin_url( 'admin.php' ) ),
				)
			);
			return;
		}

		// Settings page.
		if ( false !== strpos( $hook, 'fair-payments-connector-settings' ) ) {
			$this->enqueue_admin_page_script( 'settings' );
			wp_set_script_translations( 'fair-payments-connector-settings', 'fair-payments-connector', Features::script_translations_path() );
			wp_localize_script(
				'fair-payments-connector-settings',
				'fairPaymentsConnectorSettings',
				array(
					// The API Tokens tab is offered only while this plugin
					// serves the token routes it calls.
					'apiTokensEnabled' => ApiTokenOwnership::is_owner(),
				)
			);
			return;
		}

		// Fee Dashboard page.
		if ( false !== strpos( $hook, 'fair-payments-connector-fee-dashboard' ) ) {
			$this->enqueue_admin_page_script( 'fee-dashboard' );
			return;
		}

		// Notifications page.
		if ( false !== strpos( $hook, 'fair-payments-connector-notifications' ) && NotificationOwnership::is_owner() ) {
			$this->enqueue_admin_page_script( 'notifications' );
			wp_set_script_translations( 'fair-payments-connector-notifications', 'fair-payments-connector', Features::script_translations_path() );
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
	 * Keep the `error` query argument on the settings page.
	 *
	 * A cancelled or failed Mollie authorization returns there with `error`,
	 * which WordPress otherwise strips from the address bar before the
	 * settings app can read it. The app removes it once it has shown the
	 * outcome.
	 *
	 * @param string[] $args Query arguments WordPress removes from admin URLs.
	 * @return string[]
	 */
	public function keep_oauth_error_query_arg( $args ) {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- only compares the admin page slug.
		if ( isset( $_GET['page'] ) && 'fair-payments-connector-settings' === $_GET['page'] ) {
			return array_values( array_diff( $args, array( 'error' ) ) );
		}

		return $args;
	}

	/**
	 * Add action links on the plugins list page.
	 *
	 * Shows a "Set up" link when Mollie is not yet configured (no OAuth connection),
	 * so admins are guided to the settings page.
	 *
	 * @param string[] $links Existing action links.
	 * @return string[] Modified action links.
	 */
	public function add_plugin_action_links( $links ) {
		if ( ! MolliePaymentHandler::is_configured() ) {
			$settings_url = add_query_arg( 'page', 'fair-payments-connector-settings', admin_url( 'admin.php' ) );
			$setup_link   = '<a href="' . esc_url( $settings_url ) . '">' . esc_html__( 'Set up', 'fair-payments-connector' ) . '</a>';
			array_unshift( $links, $setup_link );
		}

		return $links;
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
	 * @param string $page Page name (transactions, transaction, settings, fee-dashboard).
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
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
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
	 * Render notifications settings page
	 *
	 * @return void
	 */
	public function render_notifications_page() {
		?>
		<div id="fair-payments-connector-notifications-root"></div>
		<?php
	}

	/**
	 * Render External Updates page
	 *
	 * @return void
	 */
	public function render_external_updates_page() {
		?>
		<div id="fair-payments-connector-external-updates-root"></div>
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
