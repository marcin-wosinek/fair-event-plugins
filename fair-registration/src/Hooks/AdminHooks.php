<?php
/**
 * Admin hooks for Fair Registration
 *
 * @package FairRegistration
 */

namespace FairRegistration\Hooks;

use FairRegistration\Admin\Controllers\AdminController;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress admin-related hooks
 */
class AdminHooks {

	/**
	 * Admin controller instance
	 *
	 * @var AdminController
	 */
	private $admin_controller;

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		$this->admin_controller = new AdminController();

		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
	}

	/**
	 * Register admin menu
	 *
	 * @return void
	 */
	public function register_admin_menu() {
		// Main menu page
		add_menu_page(
			__( 'Fair Registration', 'fair-registration' ),
			__( 'Fair Registration', 'fair-registration' ),
			'manage_options',
			'fair-registration',
			array( $this->admin_controller, 'forms_list' ),
			'dashicons-clipboard',
			31
		);

		// Forms list submenu (same as main menu)
		add_submenu_page(
			'fair-registration',
			__( 'Registration Forms', 'fair-registration' ),
			__( 'Forms', 'fair-registration' ),
			'manage_options',
			'fair-registration',
			array( $this->admin_controller, 'forms_list' )
		);

		// Registrations submenu
		add_submenu_page(
			'fair-registration',
			__( 'Registrations', 'fair-registration' ),
			__( 'Registrations', 'fair-registration' ),
			'manage_options',
			'fair-registration-registrations',
			array( $this->admin_controller, 'registrations' )
		);
	}
}
