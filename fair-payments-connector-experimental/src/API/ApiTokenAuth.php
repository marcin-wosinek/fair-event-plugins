<?php
/**
 * Bearer token authentication for the data sharing API.
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\API;

use FairEventsShared\ApiTokens\AbstractApiTokenAuth;
use FairPaymentsConnectorExperimental\Models\ApiToken;

defined( 'WPINC' ) || die;

/**
 * Authenticates public external REST endpoints via scoped bearer tokens.
 */
class ApiTokenAuth extends AbstractApiTokenAuth {

	/**
	 * Token model class.
	 *
	 * @return string
	 */
	protected static function token_model() {
		return ApiToken::class;
	}

	/**
	 * Message for a valid token that lacks the required scope.
	 *
	 * @return string
	 */
	protected static function insufficient_scope_message() {
		return __( 'This token does not have the required scope.', 'fair-payments-connector-experimental' );
	}

	/**
	 * Message for a missing, malformed, unknown or revoked token.
	 *
	 * @return string
	 */
	protected static function unauthorized_message() {
		return __( 'Invalid or missing API token.', 'fair-payments-connector-experimental' );
	}
}
