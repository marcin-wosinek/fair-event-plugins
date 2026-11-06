<?php
/**
 * Public external REST API controller for transactions.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairEventsShared\API\AbstractExternalTransactionsController;

/**
 * Handles the public GET /external/transactions endpoint over Fair Payments
 * Connector's transactions.
 */
class ExternalTransactionsController extends AbstractExternalTransactionsController {

	/**
	 * Namespace for the REST API.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Auth class.
	 *
	 * @return string
	 */
	protected function auth_class() {
		return ApiTokenAuth::class;
	}

	/**
	 * Fair Payments Connector's transaction model.
	 *
	 * @return string
	 */
	protected function transaction_model() {
		return \FairPaymentsConnector\Models\Transaction::class;
	}

	/**
	 * Description of the `from` parameter.
	 *
	 * @return string
	 */
	protected function from_description() {
		return __( 'Filter by transaction date (created_at) from this date, e.g. 2026-01-01.', 'fair-payments-connector' );
	}

	/**
	 * Description of the `to` parameter.
	 *
	 * @return string
	 */
	protected function to_description() {
		return __( 'Filter by transaction date (created_at) up to this date, e.g. 2026-12-31.', 'fair-payments-connector' );
	}
}
