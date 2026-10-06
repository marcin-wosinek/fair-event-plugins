<?php
/**
 * REST API hooks for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\API;

use FairPaymentsConnectorExperimental\Core\ApiTokenFallback;

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
		add_filter(
			'fair_payments_connector_external_update_connected_site',
			array( ConnectedSitesController::class, 'resolve_external_update_source' ),
			10,
			2
		);
	}

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		// API tokens live in Fair Payments Connector; these are a fallback
		// for a release of it that predates the move.
		if ( ApiTokenFallback::is_owner() ) {
			$api_tokens_controller = new \FairPaymentsConnectorExperimental\API\ApiTokensController();
			$api_tokens_controller->register_routes();

			$external_me = new \FairPaymentsConnectorExperimental\API\ExternalMeController();
			$external_me->register_routes();

			$external_transactions = new \FairPaymentsConnectorExperimental\API\ExternalTransactionsController();
			$external_transactions->register_routes();
		}

		$connected_sites_controller = new \FairPaymentsConnectorExperimental\API\ConnectedSitesController();
		$connected_sites_controller->register_routes();
	}
}
