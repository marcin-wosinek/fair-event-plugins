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
		// Main transactions page.
		add_menu_page(
			__( 'Fair Payment', 'fair-payment' ),
			__( 'Fair Payment', 'fair-payment' ),
			'manage_options',
			'fair-payment-transactions',
			array( $this, 'render_transactions_page' ),
			'dashicons-money-alt',
			21
		);

		// Transactions submenu (duplicate to rename main menu item).
		add_submenu_page(
			'fair-payment-transactions',
			__( 'Transactions', 'fair-payment' ),
			__( 'Transactions', 'fair-payment' ),
			'manage_options',
			'fair-payment-transactions'
		);

		// Budgeting submenus (only if budgeting is enabled).
		if ( get_option( 'fair_payment_enable_budgets', false ) ) {
			// Financial Entries submenu.
			add_submenu_page(
				'fair-payment-transactions',
				__( 'Financial Entries', 'fair-payment' ),
				__( 'Entries', 'fair-payment' ),
				'manage_options',
				'fair-payment-entries',
				array( $this, 'render_entries_page' )
			);

			// Budget Categories submenu.
			add_submenu_page(
				'fair-payment-transactions',
				__( 'Budget Categories', 'fair-payment' ),
				__( 'Budgets', 'fair-payment' ),
				'manage_options',
				'fair-payment-budgets',
				array( $this, 'render_budgets_page' )
			);

			// Reconciliation submenu.
			add_submenu_page(
				'fair-payment-transactions',
				__( 'Reconciliation', 'fair-payment' ),
				__( 'Reconciliation', 'fair-payment' ),
				'manage_options',
				'fair-payment-reconciliation',
				array( $this, 'render_reconciliation_page' )
			);
		}

		// Hidden transaction detail page.
		$transaction_hookname = add_submenu_page(
			'',
			__( 'Transaction Detail', 'fair-payment' ),
			__( 'Transaction Detail', 'fair-payment' ),
			'manage_options',
			'fair-payment-transaction',
			array( $this, 'render_transaction_page' )
		);

		// Set page title for hidden page to prevent strip_tags() deprecation warning.
		$this->set_hidden_page_title( $transaction_hookname, __( 'Transaction Detail', 'fair-payment' ) );

		// Settings submenu.
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
		// Transactions page.
		if ( 'toplevel_page_fair-payment-transactions' === $hook ) {
			$this->enqueue_admin_page_script( 'transactions' );
			wp_localize_script(
				'fair-payment-transactions',
				'fairPaymentTransactions',
				array(
					'organizationId' => get_option( 'fair_payment_organization_id', '' ),
				)
			);
			return;
		}

		// Settings page.
		if ( false !== strpos( $hook, 'fair-payment-settings' ) ) {
			$this->enqueue_admin_page_script( 'settings' );
			return;
		}

		// Budgets page.
		if ( false !== strpos( $hook, 'fair-payment-budgets' ) ) {
			$this->enqueue_admin_page_script( 'budgets' );
			return;
		}

		// Transaction detail page.
		if ( 'admin_page_fair-payment-transaction' === $hook ) {
			$this->enqueue_admin_page_script( 'transaction' );
			wp_localize_script(
				'fair-payment-transaction',
				'fairPaymentTransactions',
				array(
					'organizationId' => get_option( 'fair_payment_organization_id', '' ),
				)
			);
			return;
		}

		// Reconciliation page.
		if ( false !== strpos( $hook, 'fair-payment-reconciliation' ) ) {
			$this->enqueue_admin_page_script( 'reconciliation' );
			return;
		}

		// Entries page.
		if ( false !== strpos( $hook, 'fair-payment-entries' ) ) {
			$this->enqueue_admin_page_script( 'entries' );
			wp_localize_script(
				'fair-payment-entries',
				'fairPaymentSettings',
				array(
					'budgetingEnabled' => (bool) get_option( 'fair_payment_enable_budgets', false ),
					'eventsEnabled'    => class_exists( 'FairEvents\Core\Plugin' ),
				)
			);
			return;
		}
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
	 * @param string $page Page name (settings, budgets, entries).
	 * @return void
	 */
	private function enqueue_admin_page_script( $page ) {
		$asset_file_path = FAIR_PAYMENT_PLUGIN_DIR . 'build/admin/' . $page . '/index.asset.php';

		if ( ! file_exists( $asset_file_path ) ) {
			error_log( 'Fair Payment: Asset file not found at ' . $asset_file_path );
			return;
		}

		$asset_file = include $asset_file_path;

		wp_enqueue_script(
			'fair-payment-' . $page,
			FAIR_PAYMENT_PLUGIN_URL . 'build/admin/' . $page . '/index.js',
			$asset_file['dependencies'],
			$asset_file['version'],
			true
		);

		wp_enqueue_style( 'wp-components' );
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
	 * Render budgets page
	 *
	 * @return void
	 */
	public function render_budgets_page() {
		?>
		<div id="fair-payment-budgets-root"></div>
		<?php
	}

	/**
	 * Render entries page
	 *
	 * @return void
	 */
	public function render_entries_page() {
		?>
		<div id="fair-payment-entries-root"></div>
		<?php
	}

	/**
	 * Render reconciliation page
	 *
	 * @return void
	 */
	public function render_reconciliation_page() {
		?>
		<div id="fair-payment-reconciliation-root"></div>
		<?php
	}

	/**
	 * Render transaction detail page
	 *
	 * @return void
	 */
	public function render_transaction_page() {
		?>
		<div id="fair-payment-transaction-root"></div>
		<?php
	}

	/**
	 * Render transactions page
	 *
	 * @return void
	 */
	public function render_transactions_page() {
		?>
		<div id="fair-payment-transactions-root"></div>
		<?php
	}
}
