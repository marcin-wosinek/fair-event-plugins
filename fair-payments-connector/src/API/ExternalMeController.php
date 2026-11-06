<?php
/**
 * Public external REST API controller for token introspection.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairEventsShared\API\AbstractExternalMeController;
use FairPaymentsConnector\Models\ApiToken;

/**
 * Handles the public GET /external/me endpoint.
 */
class ExternalMeController extends AbstractExternalMeController {

	/**
	 * Namespace for the REST API.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Token model class.
	 *
	 * @return string
	 */
	protected function token_model() {
		return ApiToken::class;
	}

	/**
	 * Auth class.
	 *
	 * @return string
	 */
	protected function auth_class() {
		return ApiTokenAuth::class;
	}
}
