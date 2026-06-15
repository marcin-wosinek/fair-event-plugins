<?php
/**
 * REST API hooks for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\API;

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
		$api_tokens_controller = new \FairPaymentsConnectorExperimental\API\ApiTokensController();
		$api_tokens_controller->register_routes();

		$external_me = new \FairPaymentsConnectorExperimental\API\ExternalMeController();
		$external_me->register_routes();

		$external_transactions = new \FairPaymentsConnectorExperimental\API\ExternalTransactionsController();
		$external_transactions->register_routes();

		$connected_sites_controller = new \FairPaymentsConnectorExperimental\API\ConnectedSitesController();
		$connected_sites_controller->register_routes();

		$telegram_controller = new \FairPaymentsConnectorExperimental\API\TelegramSettingsController();
		$telegram_controller->register_routes();
	}
}
