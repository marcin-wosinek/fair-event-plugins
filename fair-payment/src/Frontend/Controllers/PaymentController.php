<?php
/**
 * Payment controller for Fair Payment frontend
 *
 * @package FairPayment
 */

namespace FairPayment\Frontend\Controllers;

use FairPayment\Frontend\Pages\CheckoutPage;
use FairPayment\Frontend\Pages\ResultPage;

defined( 'WPINC' ) || die;

/**
 * Payment controller class
 */
class PaymentController {

	/**
	 * Handle checkout page requests
	 *
	 * @param string|null $payment_id Optional payment ID.
	 * @return void
	 */
	public function checkout( $payment_id = null ) {
		// Set page title
		add_filter(
			'wp_title',
			function ( $title ) {
				return esc_html__( 'Checkout', 'fair-payment' ) . ' | ' . get_bloginfo( 'name' );
			}
		);

		// Enqueue frontend styles if needed
		$this->enqueue_frontend_assets();

		$page = new CheckoutPage( $payment_id );
		$page->render();

		// Prevent WordPress from loading other templates
		exit;
	}

	/**
	 * Handle result page requests
	 *
	 * @param string|null $payment_id Optional payment ID.
	 * @return void
	 */
	public function result( $payment_id = null ) {
		// Set page title
		add_filter(
			'wp_title',
			function ( $title ) {
				return esc_html__( 'Payment Result', 'fair-payment' ) . ' | ' . get_bloginfo( 'name' );
			}
		);

		// Enqueue frontend styles if needed
		$this->enqueue_frontend_assets();

		$page = new ResultPage( $payment_id );
		$page->render();

		// Prevent WordPress from loading other templates
		exit;
	}

	/**
	 * Enqueue frontend assets for payment pages
	 *
	 * @return void
	 */
	private function enqueue_frontend_assets() {
		// Enqueue WordPress default styles for consistent appearance
		wp_enqueue_style( 'wp-admin' );

		// Add custom styles for payment pages
		$custom_css = '
		.fair-payment-container {
			max-width: 800px;
			margin: 2rem auto;
			padding: 2rem;
			background: #fff;
			border-radius: 8px;
			box-shadow: 0 2px 10px rgba(0,0,0,0.1);
		}
		.fair-payment-header {
			text-align: center;
			margin-bottom: 2rem;
			padding-bottom: 1rem;
			border-bottom: 1px solid #ddd;
		}
		.fair-payment-form {
			margin: 2rem 0;
		}
		.fair-payment-form label {
			display: block;
			margin-bottom: 0.5rem;
			font-weight: bold;
		}
		.fair-payment-form input,
		.fair-payment-form select {
			width: 100%;
			padding: 0.75rem;
			border: 1px solid #ddd;
			border-radius: 4px;
			margin-bottom: 1rem;
		}
		.fair-payment-button {
			background: #0073aa;
			color: white;
			padding: 1rem 2rem;
			border: none;
			border-radius: 4px;
			cursor: pointer;
			font-size: 1rem;
		}
		.fair-payment-button:hover {
			background: #005a87;
		}
		.fair-payment-status {
			padding: 1rem;
			border-radius: 4px;
			margin: 1rem 0;
		}
		.fair-payment-status.success {
			background: #d4edda;
			color: #155724;
			border: 1px solid #c3e6cb;
		}
		.fair-payment-status.error {
			background: #f8d7da;
			color: #721c24;
			border: 1px solid #f5c6cb;
		}
		';

		wp_add_inline_style( 'wp-admin', $custom_css );
	}
}
