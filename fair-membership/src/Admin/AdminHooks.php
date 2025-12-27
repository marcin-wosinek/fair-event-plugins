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
			__( 'All Users', 'fair-membership' ),
			__( 'All Users', 'fair-membership' ),
			'manage_options',
			'fair-membership-matrix',
			array( $this, 'membership_matrix_page' )
		);

		add_submenu_page(
			'fair-membership',
			__( 'Group Fees', 'fair-membership' ),
			__( 'Group Fees', 'fair-membership' ),
			'manage_options',
			'fair-membership-group-fees',
			array( $this, 'group_fees_page' )
		);

		add_submenu_page(
			'fair-membership',
			__( 'User Fees', 'fair-membership' ),
			__( 'User Fees', 'fair-membership' ),
			'manage_options',
			'fair-membership-user-fees',
			array( $this, 'user_fees_page' )
		);

		// Hidden page for managing group members
		add_submenu_page(
			'', // Hidden from menu (empty string instead of null for PHP 8.1+ compatibility)
			__( 'Group Members', 'fair-membership' ),
			__( 'Group Members', 'fair-membership' ),
			'manage_options',
			'fair-membership-group-members',
			array( $this, 'group_members_page' )
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
	 * Display membership matrix page
	 *
	 * @return void
	 */
	public function membership_matrix_page() {
		$matrix_page = new MembershipMatrixPage();
		$matrix_page->render();
	}

	/**
	 * Display group members page
	 *
	 * @return void
	 */
	public function group_members_page() {
		$members_page = new GroupMembersPage();
		$members_page->render();
	}

	/**
	 * Display group fees page
	 *
	 * @return void
	 */
	public function group_fees_page() {
		$page = new GroupFeesPage();
		$page->render();
	}

	/**
	 * Display user fees page
	 *
	 * @return void
	 */
	public function user_fees_page() {
		$page = new UserFeesPage();
		$page->render();
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		$plugin_dir = plugin_dir_path( dirname( __DIR__ ) );

		// Load scripts for Groups page
		if ( 'toplevel_page_fair-membership' === $hook ) {
			$asset_file = $plugin_dir . 'build/admin/groups/index.asset.php';

			if ( file_exists( $asset_file ) ) {
				$asset_data = include $asset_file;

				wp_enqueue_script(
					'fair-membership-groups',
					plugin_dir_url( dirname( __DIR__ ) ) . 'build/admin/groups/index.js',
					$asset_data['dependencies'],
					$asset_data['version'],
					true
				);

				wp_set_script_translations(
					'fair-membership-groups',
					'fair-membership',
					$plugin_dir . 'build/languages'
				);

				wp_enqueue_style( 'wp-components' );
			}
		}

		// Load scripts for Membership Matrix page
		if ( 'fair-membership_page_fair-membership-matrix' === $hook ) {
			$asset_file = $plugin_dir . 'build/admin/users/index.asset.php';

			if ( file_exists( $asset_file ) ) {
				$asset_data = include $asset_file;

				wp_enqueue_script(
					'fair-membership-matrix',
					plugin_dir_url( dirname( __DIR__ ) ) . 'build/admin/users/index.js',
					$asset_data['dependencies'],
					$asset_data['version'],
					true
				);

				wp_set_script_translations(
					'fair-membership-matrix',
					'fair-membership',
					$plugin_dir . 'build/languages'
				);

				wp_enqueue_style( 'wp-components' );
			}
		}

		// Load scripts for Group Members page
		if ( 'admin_page_fair-membership-group-members' === $hook ) {
			$asset_file = $plugin_dir . 'build/admin/group-members/index.asset.php';

			if ( file_exists( $asset_file ) ) {
				$asset_data = include $asset_file;

				wp_enqueue_script(
					'fair-membership-group-members',
					plugin_dir_url( dirname( __DIR__ ) ) . 'build/admin/group-members/index.js',
					$asset_data['dependencies'],
					$asset_data['version'],
					true
				);

				wp_set_script_translations(
					'fair-membership-group-members',
					'fair-membership',
					$plugin_dir . 'build/languages'
				);

				wp_enqueue_style( 'wp-components' );
			}
		}

		// Load scripts for Group Fees page
		if ( 'fair-membership_page_fair-membership-group-fees' === $hook ) {
			$asset_file = $plugin_dir . 'build/admin/group-fees/index.asset.php';

			if ( file_exists( $asset_file ) ) {
				$asset_data = include $asset_file;

				wp_enqueue_script(
					'fair-membership-group-fees',
					plugin_dir_url( dirname( __DIR__ ) ) . 'build/admin/group-fees/index.js',
					$asset_data['dependencies'],
					$asset_data['version'],
					true
				);

				wp_set_script_translations(
					'fair-membership-group-fees',
					'fair-membership',
					$plugin_dir . 'build/languages'
				);

				wp_enqueue_style( 'wp-components' );
			}
		}

		// Load scripts for User Fees page
		if ( 'fair-membership_page_fair-membership-user-fees' === $hook ) {
			$asset_file = $plugin_dir . 'build/admin/user-fees/index.asset.php';

			if ( file_exists( $asset_file ) ) {
				$asset_data = include $asset_file;

				wp_enqueue_script(
					'fair-membership-user-fees',
					plugin_dir_url( dirname( __DIR__ ) ) . 'build/admin/user-fees/index.js',
					$asset_data['dependencies'],
					$asset_data['version'],
					true
				);

				wp_set_script_translations(
					'fair-membership-user-fees',
					'fair-membership',
					$plugin_dir . 'build/languages'
				);

				wp_enqueue_style( 'wp-components' );
			}
		}
	}
}
