<?php
/**
 * Admin controller for Fair Registration
 *
 * @package FairRegistration
 */

namespace FairRegistration\Admin\Controllers;

use FairRegistration\Admin\Pages\FormsListPage;
use FairRegistration\Admin\Pages\RegistrationsPage;

defined( 'WPINC' ) || die;

/**
 * Admin controller class
 */
class AdminController {

	/**
	 * Handle forms list page
	 *
	 * @return void
	 */
	public function forms_list() {
		$page = new FormsListPage();
		$page->render();
	}

	/**
	 * Handle registrations page
	 *
	 * @return void
	 */
	public function registrations() {
		$page = new RegistrationsPage();
		$page->render();
	}

	/**
	 * Handle individual form registrations view
	 *
	 * @param int $form_id Form ID.
	 * @return void
	 */
	public function form_registrations( $form_id ) {
		$page = new RegistrationsPage();
		$page->render( $form_id );
	}
}