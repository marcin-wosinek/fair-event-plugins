<?php
/**
 * REST API hooks for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\API;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress REST API hooks and endpoints
 */
class RestHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		$payment_endpoint = new \FairPayment\API\PaymentEndpoint();
		$payment_endpoint->register_routes();

		$webhook_endpoint = new \FairPayment\API\WebhookEndpoint();
		$webhook_endpoint->register_routes();

		$connection_controller = new \FairPayment\API\ConnectionController();
		$connection_controller->register_routes();
	}
}
