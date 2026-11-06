<?php
/**
 * Admin REST API controller for API tokens.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairEventsShared\API\AbstractApiTokensController;
use FairPaymentsConnector\Models\ApiToken;

/**
 * Handles admin endpoints for listing, creating and revoking API tokens.
 */
class ApiTokensController extends AbstractApiTokensController {

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
	 * Message for a missing or blank label.
	 *
	 * @return string
	 */
	protected function invalid_label_message() {
		return __( 'A label is required.', 'fair-payments-connector' );
	}

	/**
	 * Message for missing or unsupported scopes.
	 *
	 * @return string
	 */
	protected function invalid_scopes_message() {
		return __( 'At least one valid scope is required.', 'fair-payments-connector' );
	}

	/**
	 * Message for a token that could not be stored.
	 *
	 * @return string
	 */
	protected function creation_failed_message() {
		return __( 'Failed to create API token.', 'fair-payments-connector' );
	}

	/**
	 * Message for an unknown token ID.
	 *
	 * @return string
	 */
	protected function not_found_message() {
		return __( 'API token not found.', 'fair-payments-connector' );
	}
}
