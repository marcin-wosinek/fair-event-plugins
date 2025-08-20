<?php
/**
 * Routes hooks for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Hooks;

use FairPayment\Frontend\Controllers\PaymentController;

defined( 'WPINC' ) || die;

/**
 * Handles custom routes and URL rewriting
 */
class RoutesHooks {

	/**
	 * Payment controller instance
	 *
	 * @var PaymentController
	 */
	private $payment_controller;

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		$this->payment_controller = new PaymentController();
		
		add_action( 'init', array( $this, 'register_routes' ) );
		add_action( 'template_redirect', array( $this, 'handle_custom_routes' ) );
		add_filter( 'query_vars', array( $this, 'add_query_vars' ) );
	}

	/**
	 * Register custom rewrite rules
	 *
	 * @return void
	 */
	public function register_routes() {
		// Flush rewrite rules if our rules aren't present
		if ( ! $this->routes_exist() ) {
			flush_rewrite_rules();
		}

		// Frontend user routes
		add_rewrite_rule(
			'^fair-payment/checkout/?$',
			'index.php?fair_payment_page=checkout',
			'top'
		);

		add_rewrite_rule(
			'^fair-payment/checkout/([^/]+)/?$',
			'index.php?fair_payment_page=checkout&payment_id=$matches[1]',
			'top'
		);

		add_rewrite_rule(
			'^fair-payment/result/?$',
			'index.php?fair_payment_page=result',
			'top'
		);

		add_rewrite_rule(
			'^fair-payment/result/([^/]+)/?$',
			'index.php?fair_payment_page=result&payment_id=$matches[1]',
			'top'
		);
	}

	/**
	 * Add custom query variables
	 *
	 * @param array $vars Existing query vars.
	 * @return array Modified query vars.
	 */
	public function add_query_vars( $vars ) {
		$vars[] = 'fair_payment_page';
		$vars[] = 'payment_id';
		return $vars;
	}

	/**
	 * Handle custom route requests
	 *
	 * @return void
	 */
	public function handle_custom_routes() {
		$page = get_query_var( 'fair_payment_page' );
		$payment_id = get_query_var( 'payment_id' );

		if ( ! $page ) {
			return;
		}

		// Disable caching for payment pages
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}

		switch ( $page ) {
			case 'checkout':
				$this->payment_controller->checkout( $payment_id );
				break;

			case 'result':
				$this->payment_controller->result( $payment_id );
				break;

			default:
				// Handle unknown routes
				wp_die( esc_html__( 'Page not found', 'fair-payment' ), 404 );
		}
	}

	/**
	 * Check if our rewrite rules exist
	 *
	 * @return bool True if rules exist.
	 */
	private function routes_exist() {
		$rules = get_option( 'rewrite_rules' );
		
		return isset( $rules['^fair-payment/checkout/?$'] ) &&
			   isset( $rules['^fair-payment/result/?$'] );
	}
}