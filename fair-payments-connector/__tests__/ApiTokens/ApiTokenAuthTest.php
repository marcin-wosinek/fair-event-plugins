<?php
/**
 * Shared bearer token authentication, through Fair Payments Connector's adapter
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\ApiTokens;

use FairEventsShared\ApiTokens\AbstractApiTokenAuth;
use FairPaymentsConnector\API\ApiTokenAuth;
use FairPaymentsConnector\Models\ApiToken;
use PHPUnit\Framework\Attributes\DataProvider;

require_once __DIR__ . '/ApiTokenTestCase.php';

/**
 * Invalid, revoked and under-scoped tokens are rejected; valid ones are
 * attached to the request and their use recorded.
 */
class ApiTokenAuthTest extends ApiTokenTestCase {

	/**
	 * The auth class is a thin adapter over the shared implementation.
	 */
	public function test_auth_extends_the_shared_implementation() {
		$this->assertTrue( is_subclass_of( ApiTokenAuth::class, AbstractApiTokenAuth::class ) );
	}

	/**
	 * Every way of not presenting a usable token gets the same 401.
	 *
	 * @param string|null $authorization Authorization header.
	 */
	#[DataProvider( 'unusable_tokens' )]
	public function test_unusable_tokens_get_the_same_401( $authorization ) {
		$revoked = $this->seed( 'revoked-token', array( 'transactions:read' ) );
		ApiToken::revoke( $revoked );

		$result = ApiTokenAuth::authenticate( $this->request( $authorization ), 'transactions:read' );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'rest_forbidden', $result->get_error_code() );
		$this->assertSame( 'Invalid or missing API token.', $result->get_error_message() );
		$this->assertSame( array( 'status' => 401 ), $result->get_error_data() );
		$this->assertSame( array( 'fair-payments-connector' ), $GLOBALS['_fair_test_gettext_domains'] );
		$this->assertNull( ApiToken::get_by_id( $revoked )->last_used_at, 'A rejected token is not recorded as used.' );
	}

	/**
	 * Authorization headers that carry no usable token.
	 *
	 * @return array[]
	 */
	public static function unusable_tokens() {
		return array(
			'missing'   => array( null ),
			'empty'     => array( '' ),
			'malformed' => array( 'Token abc' ),
			'blank'     => array( 'Bearer   ' ),
			'unknown'   => array( 'Bearer ' . str_repeat( 'x', 40 ) ),
			'revoked'   => array( 'Bearer revoked-token' ),
		);
	}

	/**
	 * A valid token without the scope gets a 403; a retired scope grants nothing.
	 */
	public function test_insufficient_scope_gets_a_403() {
		$this->seed( 'locations-only', array( 'locations:read' ) );

		$result = ApiTokenAuth::authenticate( $this->request( 'Bearer locations-only' ), 'transactions:read' );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'rest_insufficient_scope', $result->get_error_code() );
		$this->assertSame( 'This token does not have the required scope.', $result->get_error_message() );
		$this->assertSame( array( 'status' => 403 ), $result->get_error_data() );
		$this->assertSame( array( 'fair-payments-connector' ), $GLOBALS['_fair_test_gettext_domains'] );

		$retired = ApiTokenAuth::authenticate( $this->request( 'Bearer locations-only' ), 'locations:read' );
		$this->assertSame( 'rest_insufficient_scope', $retired->get_error_code() );
	}

	/**
	 * A valid token is attached to the request and its use recorded.
	 */
	public function test_valid_token_is_attached_and_recorded() {
		$id      = $this->seed( 'valid-token', array( 'transactions:read', 'locations:read' ) );
		$request = $this->request( 'bearer  valid-token ' );

		$this->assertTrue( ApiTokenAuth::authenticate( $request, 'transactions:read' ) );
		$this->assertSame( (string) $id, $request->get_param( '_fair_api_token' )->id );
		$this->assertNotNull( ApiToken::get_by_id( $id )->last_used_at );
	}

	/**
	 * The permission callbacks delegate to the plugin's adapter.
	 */
	public function test_permission_callbacks_use_the_adapter() {
		$this->seed( 'locations-only', array( 'locations:read' ) );

		$this->assertTrue( call_user_func( ApiTokenAuth::require_token(), $this->request( 'Bearer locations-only' ) ) );

		$scoped = call_user_func( ApiTokenAuth::require_scope( 'transactions:read' ), $this->request( 'Bearer locations-only' ) );
		$this->assertSame( 'rest_insufficient_scope', $scoped->get_error_code() );

		$missing = call_user_func( ApiTokenAuth::require_token(), $this->request() );
		$this->assertSame( 'rest_forbidden', $missing->get_error_code() );
		$this->assertSame( array( 'fair-payments-connector', 'fair-payments-connector' ), $GLOBALS['_fair_test_gettext_domains'] );
	}
}
