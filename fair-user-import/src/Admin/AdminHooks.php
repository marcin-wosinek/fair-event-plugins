<?php
/**
 * Admin hooks for Fair User Import
 *
 * @package FairUserImport
 */

namespace FairUserImport\Admin;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress admin hooks and menu registration
 */
class AdminHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_menu() {
		add_submenu_page(
			'tools.php',
			__( 'Import Users', 'fair-user-import' ),
			__( 'Import Users', 'fair-user-import' ),
			'manage_options',
			'fair-user-import',
			array( $this, 'import_users_page' )
		);
	}

	/**
	 * Display import users page
	 *
	 * @return void
	 */
	public function import_users_page() {
		$import_page = new ImportUsersPage();
		$import_page->render();
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		// Only load scripts on the import users page.
		if ( 'tools_page_fair-user-import' !== $hook ) {
			return;
		}

		$plugin_dir = plugin_dir_path( dirname( __DIR__ ) );
		$asset_file = $plugin_dir . 'build/admin/import-users/index.asset.php';

		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset_data = include $asset_file;

		wp_enqueue_script(
			'fair-user-import',
			plugin_dir_url( dirname( __DIR__ ) ) . 'build/admin/import-users/index.js',
			$asset_data['dependencies'],
			$asset_data['version'],
			true
		);

		// Pass data to JavaScript.
		wp_localize_script(
			'fair-user-import',
			'fairUserImportData',
			array(
				'hasFairMembership' => $this->has_fair_membership(),
			)
		);

		wp_enqueue_style( 'wp-components' );
	}

	/**
	 * Check if Fair Membership plugin is active
	 *
	 * @return bool
	 */
	private function has_fair_membership() {
		return class_exists( 'FairMembership\Models\Group' );
	}
}
