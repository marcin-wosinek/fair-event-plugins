<?php
/**
 * Admin hooks for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

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
		add_menu_page(
			__( 'Fair Membership', 'fair-membership' ),
			__( 'Fair Membership', 'fair-membership' ),
			'manage_options',
			'fair-membership',
			array( $this, 'groups_list_page' ),
			'dashicons-groups',
			30
		);

		add_submenu_page(
			'fair-membership',
			__( 'Groups', 'fair-membership' ),
			__( 'Groups', 'fair-membership' ),
			'manage_options',
			'fair-membership',
			array( $this, 'groups_list_page' )
		);

		add_submenu_page(
			'fair-membership',
			__( 'View Group', 'fair-membership' ),
			null,
			'manage_options',
			'fair-membership-group-view',
			array( $this, 'group_view_page' )
		);

		add_submenu_page(
			'fair-membership',
			__( 'All Users', 'fair-membership' ),
			__( 'All Users', 'fair-membership' ),
			'manage_options',
			'fair-membership-matrix',
			array( $this, 'membership_matrix_page' )
		);
	}

	/**
	 * Display groups list page
	 *
	 * @return void
	 */
	public function groups_list_page() {
		$groups_page = new GroupsListPage();
		$groups_page->render();
	}

	/**
	 * Display group view page
	 *
	 * @return void
	 */
	public function group_view_page() {
		$group_page = new GroupViewPage();
		$group_page->render();
	}

	/**
	 * Display membership matrix page
	 *
	 * @return void
	 */
	public function membership_matrix_page() {
		$matrix_page = new MembershipMatrixPage();
		$matrix_page->render();
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		// Only load on Fair Membership matrix page
		if ( 'fair-membership_page_fair-membership-matrix' !== $hook ) {
			return;
		}

		$plugin_dir = plugin_dir_path( dirname( __DIR__ ) );
		$asset_file = $plugin_dir . 'build/admin/users/index.asset.php';

		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset_data = include $asset_file;

		wp_enqueue_script(
			'fair-membership-matrix',
			plugin_dir_url( dirname( __DIR__ ) ) . 'build/admin/users/index.js',
			$asset_data['dependencies'],
			$asset_data['version'],
			true
		);

		wp_enqueue_style( 'wp-components' );
	}
}
