<?php
/**
 * REST API hooks for Fair Payments Connector
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

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
		$payment_endpoint = new \FairPaymentsConnector\API\PaymentEndpoint();
		$payment_endpoint->register_routes();

		$webhook_endpoint = new \FairPaymentsConnector\API\WebhookEndpoint();
		$webhook_endpoint->register_routes();

		$connection_controller = new \FairPaymentsConnector\API\ConnectionController();
		$connection_controller->register_routes();

		$transactions_controller = new \FairPaymentsConnector\API\TransactionsController();
		$transactions_controller->register_routes();

		$payment_log_controller = new \FairPaymentsConnector\API\PaymentLogController();
		$payment_log_controller->register_routes();

		$telegram_controller = new \FairPaymentsConnector\API\TelegramSettingsController();
		$telegram_controller->register_routes();

		$api_tokens_controller = new \FairPaymentsConnector\API\ApiTokensController();
		$api_tokens_controller->register_routes();

		$external_transactions = new \FairPaymentsConnector\API\ExternalTransactionsController();
		$external_transactions->register_routes();

		$external_me = new \FairPaymentsConnector\API\ExternalMeController();
		$external_me->register_routes();

		$connected_sites_controller = new \FairPaymentsConnector\API\ConnectedSitesController();
		$connected_sites_controller->register_routes();

		$dashboard_controller = new \FairPaymentsConnector\API\DashboardController();
		$dashboard_controller->register_routes();
	}
}
