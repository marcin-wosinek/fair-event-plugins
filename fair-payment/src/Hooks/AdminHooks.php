<?php
/**
 * Admin hooks for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Hooks;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress admin-related hooks
 */
class AdminHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
	}

	/**
	 * Register admin menu
	 *
	 * @return void
	 */
	public function register_admin_menu() {
		require_once plugin_dir_path( dirname( dirname( __FILE__ ) ) ) . '/src/admin/admin-page.php';
		\FairPayment\Admin\register_admin_menu();
	}
}
