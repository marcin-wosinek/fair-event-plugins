<?php
/**
 * Admin Pages for Fair Finance
 *
 * @package FairFinance
 */

namespace FairFinance\Admin;

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
		add_menu_page(
			__( 'Fair Finance', 'fair-finance' ),
			__( 'Fair Finance', 'fair-finance' ),
			'manage_options',
			'fair-finance-entries',
			array( $this, 'render_entries_page' ),
			'dashicons-chart-bar',
			'20.3'
		);

		// Entries submenu (duplicate to rename main menu item).
		add_submenu_page(
			'fair-finance-entries',
			__( 'Financial Entries', 'fair-finance' ),
			__( 'Entries', 'fair-finance' ),
			'manage_options',
			'fair-finance-entries'
		);

		// Budget Categories submenu.
		add_submenu_page(
			'fair-finance-entries',
			__( 'Budget Categories', 'fair-finance' ),
			__( 'Budgets', 'fair-finance' ),
			'manage_options',
			'fair-finance-budgets',
			array( $this, 'render_budgets_page' )
		);

		// Reconciliation submenu.
		add_submenu_page(
			'fair-finance-entries',
			__( 'Reconciliation', 'fair-finance' ),
			__( 'Reconciliation', 'fair-finance' ),
			'manage_options',
			'fair-finance-reconciliation',
			array( $this, 'render_reconciliation_page' )
		);
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		// Budgets page.
		if ( false !== strpos( $hook, 'fair-finance-budgets' ) ) {
			$this->enqueue_admin_page_script( 'budgets' );
			return;
		}

		// Reconciliation page.
		if ( false !== strpos( $hook, 'fair-finance-reconciliation' ) ) {
			$this->enqueue_admin_page_script( 'reconciliation' );
			return;
		}

		// Entries page (check last — slug is also the top-level menu slug).
		if ( 'toplevel_page_fair-finance-entries' === $hook || false !== strpos( $hook, 'fair-finance-entries' ) ) {
			$this->enqueue_admin_page_script( 'entries' );
			wp_localize_script(
				'fair-finance-entries',
				'fairPaymentSettings',
				array(
					'eventsEnabled' => class_exists( 'FairEvents\Core\Plugin' ),
				)
			);
			return;
		}
	}

	/**
	 * Enqueue script for an admin page
	 *
	 * @param string $page Page name (budgets, entries, reconciliation).
	 * @return void
	 */
	private function enqueue_admin_page_script( $page ) {
		$asset_file_path = FAIR_FINANCE_DIR . 'build/admin/' . $page . '/index.asset.php';

		if ( ! file_exists( $asset_file_path ) ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( 'Fair Finance: Asset file not found at ' . $asset_file_path );
			}
			return;
		}

		$asset_file = include $asset_file_path;

		wp_enqueue_script(
			'fair-finance-' . $page,
			FAIR_FINANCE_URL . 'build/admin/' . $page . '/index.js',
			$asset_file['dependencies'],
			$asset_file['version'],
			true
		);

		wp_enqueue_style( 'wp-components' );

		// Enqueue the page's stylesheet when one was emitted by the build.
		$style_file_path = FAIR_FINANCE_DIR . 'build/admin/' . $page . '/style-index.css';

		if ( file_exists( $style_file_path ) ) {
			wp_enqueue_style(
				'fair-finance-' . $page,
				FAIR_FINANCE_URL . 'build/admin/' . $page . '/style-index.css',
				array( 'wp-components' ),
				$asset_file['version']
			);
		}
	}

	/**
	 * Render entries page
	 *
	 * @return void
	 */
	public function render_entries_page() {
		?>
		<div id="fair-finance-entries-root"></div>
		<?php
	}

	/**
	 * Render budgets page
	 *
	 * @return void
	 */
	public function render_budgets_page() {
		?>
		<div id="fair-finance-budgets-root"></div>
		<?php
	}

	/**
	 * Render reconciliation page
	 *
	 * @return void
	 */
	public function render_reconciliation_page() {
		?>
		<div id="fair-finance-reconciliation-root"></div>
		<?php
	}
}
