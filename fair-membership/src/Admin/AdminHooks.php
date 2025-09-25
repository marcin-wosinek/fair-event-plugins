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
}
