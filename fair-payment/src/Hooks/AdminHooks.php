<?php
/**
 * Admin hooks for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Hooks;

use FairPayment\Admin\Controllers\AdminController;
use FairPayment\Admin\Pages\SettingsPage;

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
		
		// Initialize settings page (registers its own hooks)
		new SettingsPage();
		
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
			__( 'Fair Payment', 'fair-payment' ),
			__( 'Fair Payment', 'fair-payment' ),
			'manage_options',
			'fair-payment',
			array( $this->admin_controller, 'settings' ),
			'dashicons-money-alt',
			30
		);

		// Settings submenu (same as main menu)
		add_submenu_page(
			'fair-payment',
			__( 'Settings', 'fair-payment' ),
			__( 'Settings', 'fair-payment' ),
			'manage_options',
			'fair-payment',
			array( $this->admin_controller, 'settings' )
		);

		// Transactions submenu
		add_submenu_page(
			'fair-payment',
			__( 'Transactions', 'fair-payment' ),
			__( 'Transactions', 'fair-payment' ),
			'manage_options',
			'fair-payment-transactions',
			array( $this->admin_controller, 'transactions' )
		);
	}
}
