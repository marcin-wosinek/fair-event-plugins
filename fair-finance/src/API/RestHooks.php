<?php
/**
 * REST API hooks for Fair Finance
 *
 * @package FairFinance
 */

namespace FairFinance\API;

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
		( new BudgetController() )->register_routes();
		( new FinancialEntryController() )->register_routes();
		( new SettlementController() )->register_routes();
	}
}
