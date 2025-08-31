<?php
/**
 * Admin controller for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Admin\Controllers;

use FairPayment\Admin\Pages\SettingsPage;
use FairPayment\Admin\Pages\StripeInfoPage;
use FairPayment\Admin\Pages\TransactionListPage;

defined( 'WPINC' ) || die;

/**
 * Admin controller class
 */
class AdminController {

	/**
	 * Handle settings page
	 *
	 * @return void
	 */
	public function settings() {
		$page = new SettingsPage();
		$page->render();
	}

	/**
	 * Handle Stripe info page
	 *
	 * @return void
	 */
	public function stripe_info() {
		$page = new StripeInfoPage();
		$page->render();
	}

	/**
	 * Handle transaction list page
	 *
	 * @return void
	 */
	public function transactions() {
		$page = new TransactionListPage();
		$page->render();
	}

	/**
	 * Handle individual transaction view
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return void
	 */
	public function transaction_view( $transaction_id ) {
		// For now, redirect to transaction list - will implement later
		wp_redirect( admin_url( 'admin.php?page=fair-payment-transactions' ) );
		exit;
	}
}
