<?php
/**
 * API Token Model
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Models;

use FairEventsShared\ApiTokens\AbstractApiToken;

defined( 'WPINC' ) || die;

/**
 * Model class for data sharing API tokens, stored in Fair Payments
 * Connector's API tokens table.
 *
 * Tokens are stored only as a SHA-256 hash; see AbstractApiToken.
 */
class ApiToken extends AbstractApiToken {
	/**
	 * Scopes a token can be created with, and the only ones that authorize
	 * anything.
	 *
	 * Tokens created before `locations:read` was retired may still store it.
	 * It stays in their API responses and grants nothing.
	 *
	 * @var string[]
	 */
	const ALLOWED_SCOPES = array( 'transactions:read' );

	/**
	 * Name of the API tokens table.
	 *
	 * @return string
	 */
	protected static function table_name() {
		return \FairPaymentsConnector\Database\Schema::get_api_tokens_table_name();
	}
}
