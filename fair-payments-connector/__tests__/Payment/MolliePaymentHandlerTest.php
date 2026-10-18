<?php
/**
 * MolliePaymentHandler test/live mode boundary tests.
 *
 * Guards against the class of bug fixed in #921: `testmode` silently dropped
 * (or smuggled into the wrong SDK argument) so a test-mode checkout creates a
 * live Mollie payment. Each test injects a faked MollieApiClient and asserts
 * directly on the outgoing SDK request, since that's where the regression
 * actually lives (see #922).
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Payment;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Payment\MolliePaymentHandler;
use FairPaymentsConnector\Payment\PaymentGatewayError;
use FairPaymentsConnector\Payment\PaymentGatewayException;
use FairPaymentsConnector\Database\PaymentLogRepository;
use FairPaymentsConnector\OAuth\GrantedScopes;
use Mollie\Api\MollieApiClient;
use Mollie\Api\Fake\MockResponse;
use Mollie\Api\Http\PendingRequest;
use Mollie\Api\Http\Requests\CreatePaymentRequest;
use Mollie\Api\Http\Requests\GetPaymentRequest;
use Mollie\Api\Http\Requests\GetEnabledMethodsRequest;
use Mollie\Api\Http\Requests\GetProfileRequest;
use Mollie\Api\Resources\Payment;
use Mollie\Api\Resources\MethodCollection;
use Mollie\Api\Resources\Profile;
use Mollie\Api\Resources\PaymentCollection;
use Mollie\Api\Http\Requests\GetPaginatedPaymentsRequest;
use Mollie\Api\Http\Requests\GetPaginatedBalanceTransactionRequest;
use Mollie\Api\Resources\BalanceTransactionCollection;

/**
 * Unit tests for MolliePaymentHandler's test/live mode handling.
 */
class MolliePaymentHandlerTest extends TestCase {

	/** Listing sends a bounded cursor, limit, descending sort, and test mode. */
	public function test_list_payments_uses_bounded_test_mode_page() {
		$mollie  = MollieApiClient::fake(
			array(
				GetPaginatedPaymentsRequest::class => MockResponse::list( PaymentCollection::class )->create(),
			)
		);
		$handler = new MolliePaymentHandler( $mollie );
		$handler->list_payments( 'tr_cursor', 25, true );
		$request = $this->sent_request( $mollie, GetPaginatedPaymentsRequest::class );
		$uri     = (string) $request->createPsrRequest()->getUri();
		$this->assertTrue( $request->getTestmode() );
		$this->assertStringContainsString( 'from=tr_cursor', $uri );
		$this->assertStringContainsString( 'limit=25', $uri );
		$this->assertStringContainsString( 'sort=desc', $uri );
	}

	/** Mapping keeps the gateway values and preserves its UTC timestamp. */
	public function test_map_payment_for_import_normalizes_supported_fields() {
		$payment = (object) array(
			'id'             => 'tr_manual',
			'amount'         => (object) array(
				'value'    => '12.50',
				'currency' => 'EUR',
			),
			'status'         => 'paid',
			'description'    => 'Manual payment',
			'mode'           => 'test',
			'createdAt'      => '2026-09-14T10:30:00+00:00',
			'applicationFee' => (object) array( 'amount' => (object) array( 'value' => '0.50' ) ),
		);
		$handler = new MolliePaymentHandler( MollieApiClient::fake() );
		$mapped  = $handler->map_payment_for_import( $payment, false );
		$this->assertSame( 'tr_manual', $mapped['mollie_payment_id'] );
		$this->assertSame( 12.5, $mapped['amount'] );
		$this->assertSame( 'EUR', $mapped['currency'] );
		$this->assertTrue( $mapped['testmode'] );
		$this->assertSame( '2026-09-14 10:30:00', $mapped['created_at'] );
		$this->assertSame( 0.5, $mapped['application_fee'] );
		$this->assertNull( $mapped['mollie_fee'] );
	}

	/**
	 * Reset shared test state before each test.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']    = array();
		$GLOBALS['_fair_test_transients'] = array();
		unset( $GLOBALS['_fair_test_remote_post'] );
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, no real $wpdb exists here.
		$GLOBALS['wpdb'] = new \Fair_Test_WPDB();
		PaymentLogRepository::reset_request_id();
	}

	/**
	 * Find the single recorded PendingRequest for a given SDK request class.
	 *
	 * @param MollieApiClient $mollie        Faked client.
	 * @param string          $request_class Fully-qualified SDK request class name.
	 * @return PendingRequest
	 */
	private function sent_request( MollieApiClient $mollie, string $request_class ): PendingRequest {
		$found = null;
		$mollie->assertSent(
			function ( PendingRequest $request ) use ( $request_class, &$found ) {
				if ( get_class( $request->getRequest() ) === $request_class ) {
					$found = $request;
					return true;
				}
				return false;
			}
		);
		return $found;
	}

	/**
	 * A Mollie payment response with the fields Mollie always sends.
	 *
	 * @param string $id        Payment ID.
	 * @param string $status    Payment status.
	 * @param array  $overrides Fields to change or add.
	 * @return MockResponse
	 */
	private function payment_response( string $id, string $status, array $overrides = array() ): MockResponse {
		return new MockResponse(
			array_merge(
				array(
					'resource'    => 'payment',
					'id'          => $id,
					'mode'        => 'test',
					'status'      => $status,
					'method'      => 'ideal',
					'description' => 'Payment',
					'createdAt'   => '2026-09-14T10:30:00+00:00',
					'amount'      => array(
						'value'    => '10.00',
						'currency' => 'EUR',
					),
					'_links'      => array(
						'checkout' => array( 'href' => 'https://www.mollie.com/checkout/' . $id ),
					),
				),
				$overrides
			)
		);
	}

	/**
	 * `fair_payment_mode = test` must set `testmode = true` on the create request.
	 */
	public function test_create_payment_in_test_mode_sets_testmode_true() {
		$GLOBALS['_fair_test_options']['fair_payment_mode'] = 'test';

		$mollie = MollieApiClient::fake(
			array(
				CreatePaymentRequest::class => $this->payment_response( 'tr_test_1', 'open' ),
			)
		);

		$handler = new MolliePaymentHandler( $mollie );
		$handler->create_payment( array( 'amount' => '10.00' ) );

		$request = $this->sent_request( $mollie, CreatePaymentRequest::class );
		$this->assertTrue( $request->getTestmode() );
	}

	/**
	 * `fair_payment_mode = live` must set `testmode = false` on the create request.
	 */
	public function test_create_payment_in_live_mode_sets_testmode_false() {
		$GLOBALS['_fair_test_options']['fair_payment_mode'] = 'live';

		$mollie = MollieApiClient::fake(
			array(
				CreatePaymentRequest::class => $this->payment_response( 'tr_live_1', 'open' ),
			)
		);

		$handler = new MolliePaymentHandler( $mollie );
		$handler->create_payment( array( 'amount' => '10.00' ) );

		$request = $this->sent_request( $mollie, CreatePaymentRequest::class );
		$this->assertFalse( $request->getTestmode() );
	}

	/**
	 * Regression lock for #921: the boundary flag (`$request->getTestmode()`, set
	 * via the SDK's third `create()` argument) is the single source of truth. If
	 * a future change smuggles a hand-written `testmode` value into the payload
	 * array instead of going through that argument, this value would diverge
	 * from the boundary flag.
	 */
	public function test_create_payment_payload_testmode_matches_boundary_flag() {
		$GLOBALS['_fair_test_options']['fair_payment_mode'] = 'test';

		$mollie = MollieApiClient::fake(
			array(
				CreatePaymentRequest::class => $this->payment_response( 'tr_test_2', 'open' ),
			)
		);

		$handler = new MolliePaymentHandler( $mollie );
		$handler->create_payment( array( 'amount' => '10.00' ) );

		$request = $this->sent_request( $mollie, CreatePaymentRequest::class );
		$payload = $request->payload();

		$this->assertTrue( $request->getTestmode() );
		$this->assertSame( $request->getTestmode(), $payload->get( 'testmode' ) );
	}

	/**
	 * OAuth path (profile ID + application fee) must still derive testmode from
	 * `fair_payment_mode`, same as the API-key path.
	 */
	public function test_oauth_path_with_application_fee_derives_testmode_from_mode() {
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected']  = true;
		$GLOBALS['_fair_test_options']['fair_payment_mollie_profile_id'] = 'pfl_test123';
		$GLOBALS['_fair_test_options']['fair_payment_mode']              = 'live';

		$mollie = MollieApiClient::fake(
			array(
				CreatePaymentRequest::class => $this->payment_response( 'tr_oauth_1', 'open' ),
			)
		);

		$handler = new MolliePaymentHandler( $mollie );
		$handler->create_payment(
			array(
				'amount'          => '10.00',
				'application_fee' => '1.00',
			)
		);

		$request = $this->sent_request( $mollie, CreatePaymentRequest::class );
		$payload = $request->payload();

		$this->assertFalse( $request->getTestmode() );
		$this->assertSame( 'pfl_test123', $payload->get( 'profileId' ) );
		$this->assertNotNull( $payload->get( 'applicationFee' ) );
	}

	/**
	 * The stored integration fee reaches Mollie unchanged — including a 2%
	 * fee above the former monthly cap — and is the only application fee sent;
	 * Mollie's own processing fee is not added to it (#1655).
	 */
	public function test_create_payment_sends_the_stored_application_fee_unchanged() {
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected']  = true;
		$GLOBALS['_fair_test_options']['fair_payment_mollie_profile_id'] = 'pfl_test123';

		$mollie = MollieApiClient::fake(
			array(
				CreatePaymentRequest::class => $this->payment_response( 'tr_uncapped_fee', 'open' ),
			)
		);

		$handler = new MolliePaymentHandler( $mollie );
		$handler->create_payment(
			array(
				'amount'          => '2000.00',
				'currency'        => 'EUR',
				'application_fee' => 40.0,
			)
		);

		$fee = $this->sent_request( $mollie, CreatePaymentRequest::class )->payload()->get( 'applicationFee' );

		$this->assertSame( '40.00', $fee['amount']['value'] );
		$this->assertSame( 'EUR', $fee['amount']['currency'] );
	}

	/**
	 * The method-allowlist lookup must query with the same testmode as the
	 * create call — one source of truth for a single checkout attempt.
	 */
	public function test_method_allowlist_uses_same_testmode_as_create() {
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected']  = true;
		$GLOBALS['_fair_test_options']['fair_payment_mollie_profile_id'] = 'pfl_test123';
		$GLOBALS['_fair_test_options']['fair_payment_mode']              = 'test';

		$mollie = MollieApiClient::fake(
			array(
				CreatePaymentRequest::class     => $this->payment_response( 'tr_allowlist_1', 'open' ),
				GetEnabledMethodsRequest::class => MockResponse::list( MethodCollection::class )
					->add(
						array(
							'id'       => 'ideal',
							'resource' => 'method',
							'status'   => 'activated',
						)
					)
					->add(
						array(
							'id'       => 'banktransfer',
							'resource' => 'method',
							'status'   => 'activated',
						)
					)
					->create(),
			)
		);

		$handler = new MolliePaymentHandler( $mollie );
		$handler->create_payment(
			array(
				'amount'          => '10.00',
				'disable_methods' => array( 'banktransfer' ),
			)
		);

		$create_request    = $this->sent_request( $mollie, CreatePaymentRequest::class );
		$allowlist_request = $this->sent_request( $mollie, GetEnabledMethodsRequest::class );

		$this->assertSame( $create_request->getTestmode(), $allowlist_request->getTestmode() );
		$this->assertTrue( $allowlist_request->getTestmode() );
	}

	/**
	 * Regression guard for the read path: `get_payment()` must pass `testmode`
	 * through to the query position, not silently drop it.
	 */
	public function test_get_payment_passes_testmode_in_query() {
		$mollie = MollieApiClient::fake(
			array(
				GetPaymentRequest::class => $this->payment_response( 'tr_get_1', 'paid' ),
			)
		);

		$handler = new MolliePaymentHandler( $mollie );
		$handler->get_payment( 'tr_get_1', array( 'testmode' => true ) );

		$request = $this->sent_request( $mollie, GetPaymentRequest::class );

		$this->assertTrue( $request->getTestmode() );
		// The SDK stringifies query booleans ('true'/'false') for URL encoding.
		$this->assertSame( 'true', $request->query()->get( 'testmode' ) );
	}

	/**
	 * Callers compare and store status and method, and hand the payment to the
	 * `fair_payment_*` hooks: both must be Mollie's plain strings, also for a
	 * value the SDK has no enum case for.
	 */
	public function test_get_payment_returns_plain_status_and_method() {
		$mollie  = MollieApiClient::fake(
			array(
				GetPaymentRequest::class => $this->payment_response( 'tr_known', 'paid' ),
			)
		);
		$payment = ( new MolliePaymentHandler( $mollie ) )->get_payment( 'tr_known' );

		$this->assertSame( 'paid', $payment->status );
		$this->assertSame( 'ideal', $payment->method );
		$this->assertSame( 'paid', sprintf( '%s', $payment->status ) );
		// The SDK's own helpers still work on the plain values.
		$this->assertFalse( $payment->isFailed() );

		$mollie  = MollieApiClient::fake(
			array(
				GetPaymentRequest::class => $this->payment_response( 'tr_unknown', 'newstatus', array( 'method' => 'newmethod' ) ),
			)
		);
		$payment = ( new MolliePaymentHandler( $mollie ) )->get_payment( 'tr_unknown' );

		$this->assertSame( 'newstatus', $payment->status );
		$this->assertSame( 'newmethod', $payment->method );
	}

	/**
	 * A payment missing a field Mollie always sends is refused with a
	 * readable error instead of failing later on an uninitialized property.
	 */
	public function test_get_payment_refuses_incomplete_payment() {
		$mollie = MollieApiClient::fake(
			array(
				GetPaymentRequest::class => new MockResponse(
					array(
						'resource' => 'payment',
						'id'       => 'tr_partial',
						'status'   => 'paid',
					)
				),
			)
		);

		$this->expectException( \Exception::class );
		$this->expectExceptionMessage( 'Failed to retrieve payment: Mollie returned a payment that could not be read.' );
		( new MolliePaymentHandler( $mollie ) )->get_payment( 'tr_partial' );
	}

	/** A provider error on read is a plain \Exception the callers already handle. */
	public function test_get_payment_wraps_provider_errors() {
		$mollie = MollieApiClient::fake(
			array( GetPaymentRequest::class => MockResponse::error( 503, 'Service Unavailable', 'Try later' ) )
		);

		$this->expectException( \Exception::class );
		$this->expectExceptionMessageMatches( '/^Failed to retrieve payment: /' );
		( new MolliePaymentHandler( $mollie ) )->get_payment( 'tr_any' );
	}

	/** Creating a payment returns plain values and Mollie's checkout URL. */
	public function test_create_payment_returns_plain_values() {
		$mollie = MollieApiClient::fake(
			array( CreatePaymentRequest::class => $this->payment_response( 'tr_created', 'open' ) )
		);

		$result = ( new MolliePaymentHandler( $mollie ) )->create_payment( array( 'amount' => '10.00' ) );

		$this->assertSame(
			array(
				'mollie_payment_id' => 'tr_created',
				'checkout_url'      => 'https://www.mollie.com/checkout/tr_created',
				'status'            => 'open',
			),
			$result
		);
	}

	/**
	 * A server error is not an ApiException in SDK v4; it must still become
	 * the sanitized PaymentGatewayException and be logged.
	 */
	public function test_create_payment_server_error_is_a_gateway_exception() {
		$mollie = MollieApiClient::fake(
			array( CreatePaymentRequest::class => MockResponse::error( 503, 'Service Unavailable', 'Try later' ) )
		);

		try {
			( new MolliePaymentHandler( $mollie ) )->create_payment(
				array(
					'amount'   => '10.00',
					'metadata' => array( 'transaction_id' => 9 ),
				)
			);
			$this->fail( 'Expected PaymentGatewayException was not thrown.' );
		} catch ( PaymentGatewayException $e ) {
			$this->assertInstanceOf( PaymentGatewayError::class, $e->get_error() );
		}

		$events = array_column( $GLOBALS['wpdb']->inserted_rows, 'event' );
		$this->assertContains( 'mollie_call_failed', $events );
	}

	/** A created payment Mollie describes incompletely is a gateway failure. */
	public function test_create_payment_refuses_incomplete_response() {
		$mollie = MollieApiClient::fake(
			array(
				CreatePaymentRequest::class => new MockResponse(
					array(
						'resource' => 'payment',
						'id'       => 'tr_partial',
					)
				),
			)
		);

		$this->expectException( PaymentGatewayException::class );
		( new MolliePaymentHandler( $mollie ) )->create_payment( array( 'amount' => '10.00' ) );
	}

	/** Listed payments are normalized too, so the import compares plain statuses. */
	public function test_list_payments_returns_plain_statuses_for_import() {
		$mollie  = MollieApiClient::fake(
			array(
				GetPaginatedPaymentsRequest::class => MockResponse::list( PaymentCollection::class )
					->add( $this->payment_response( 'tr_listed', 'paid' )->json() )
					->create(),
			)
		);
		$handler = new MolliePaymentHandler( $mollie );
		$page    = $handler->list_payments( null, 25, true );
		$listed  = iterator_to_array( $page )[0];
		$mapped  = $handler->map_payment_for_import( $listed, false );

		$this->assertSame( 'paid', $listed->status );
		$this->assertSame( 'paid', $mapped['status'] );
		$this->assertSame( 10.0, $mapped['amount'] );
		$this->assertTrue( $mapped['testmode'] );
	}

	/**
	 * The balance lookup passes test mode as a real bool: SDK v4 rejects the
	 * 'true' string the query once carried.
	 */
	public function test_balance_transactions_iterate_in_test_mode() {
		$mollie = MollieApiClient::fake(
			array(
				GetPaginatedBalanceTransactionRequest::class => MockResponse::list( BalanceTransactionCollection::class )
					->add(
						array(
							'resource'   => 'balance_transaction',
							'id'         => 'baltr_unit0001',
							'type'       => 'payment',
							'createdAt'  => '2026-09-14T10:30:00+00:00',
							'context'    => array( 'paymentId' => 'tr_fee' ),
							'deductions' => array(
								'value'    => '-0.79',
								'currency' => 'EUR',
							),
						)
					)
					->create(),
			)
		);

		$transactions = iterator_to_array( ( new MolliePaymentHandler( $mollie ) )->iterate_primary_balance_transactions( true ), false );

		$this->assertTrue( $this->sent_request( $mollie, GetPaginatedBalanceTransactionRequest::class )->getTestmode() );
		$this->assertSame( 'tr_fee', $transactions[0]->context->paymentId );
		$this->assertSame( '-0.79', $transactions[0]->deductions->value );
	}

	/**
	 * Regression guard for the #1208 follow-up fix: `get_connection_overview()`
	 * must resolve the profile via the stored ID, not `/profiles/me` -- an
	 * org-level OAuth token 403s on `/me` since it isn't bound to one profile.
	 */
	public function test_get_connection_overview_uses_stored_profile_id_not_me() {
		$GLOBALS['_fair_test_options']['fair_payment_mollie_profile_id'] = 'pfl_test123';
		$GLOBALS['_fair_test_options']['fair_payment_mode']              = 'test';

		$mollie = MollieApiClient::fake(
			array(
				GetProfileRequest::class        => MockResponse::resource( Profile::class )
					->with(
						array(
							'id'   => 'pfl_test123',
							'name' => 'My Test Shop',
						)
					)->create(),
				GetEnabledMethodsRequest::class => MockResponse::list( MethodCollection::class )
					->add(
						array(
							'id'          => 'ideal',
							'description' => 'iDEAL',
							'resource'    => 'method',
							'status'      => 'activated',
						)
					)
					->create(),
			)
		);

		$handler  = new MolliePaymentHandler( $mollie );
		$overview = $handler->get_connection_overview();

		$profile_request = $this->sent_request( $mollie, GetProfileRequest::class );

		$this->assertSame( 'profiles/pfl_test123', $profile_request->getRequest()->resolveResourcePath() );
		$this->assertSame( 'My Test Shop', $overview['profile_name'] );
		$this->assertSame( 'pfl_test123', $overview['profile_id'] );
	}

	/**
	 * A missing stored profile ID must throw a clear "not configured" error
	 * instead of attempting a `/profiles/me` call, which can only 403 under
	 * an org-level OAuth token.
	 */
	public function test_get_connection_overview_throws_when_profile_id_missing() {
		$mollie = MollieApiClient::fake( array() );

		$handler = new MolliePaymentHandler( $mollie );

		$this->expectException( \Exception::class );
		$this->expectExceptionMessageMatches( '/not configured/' );

		$handler->get_connection_overview();
	}

	/**
	 * Regression lock for #1317: API key authentication was removed, so a site
	 * with no OAuth connection must fail with a clear "not connected" error
	 * when constructing the real client — never fall back to a stored key.
	 */
	public function test_constructor_throws_when_not_connected() {
		$this->expectException( \Exception::class );
		$this->expectExceptionMessageMatches( '/not connected/' );

		new MolliePaymentHandler();
	}

	/**
	 * Seed an expired OAuth connection and the platform's refresh response.
	 *
	 * @param array $refresh_data Token data the platform returns for the refresh.
	 * @return void
	 */
	private function seed_expired_connection( array $refresh_data ): void {
		$GLOBALS['_fair_test_options'] = array(
			'fair_payment_mollie_connected'     => true,
			'fair_payment_mollie_access_token'  => 'access_old',
			'fair_payment_mollie_refresh_token' => 'refresh_old',
			'fair_payment_mollie_token_expires' => time() - 60,
			'fair_payment_mollie_scopes'        => array( 'payments.read', 'payments.write' ),
		);

		$GLOBALS['_fair_test_remote_post'] = array(
			// phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode
			'body' => json_encode(
				array(
					'success' => true,
					'data'    => array( 'data' => $refresh_data ),
				)
			),
		);
	}

	/**
	 * #1693: a refresh that reports no scopes keeps the recorded ones and the
	 * stored refresh token — it never grants a permission by itself.
	 */
	public function test_refresh_without_scope_preserves_recorded_scopes_and_refresh_token() {
		$this->seed_expired_connection(
			array(
				'access_token' => 'access_new',
				'expires_in'   => 3600,
			)
		);

		new MolliePaymentHandler();

		$options = $GLOBALS['_fair_test_options'];
		$this->assertSame( 'access_new', $options['fair_payment_mollie_access_token'] );
		$this->assertSame( 'refresh_old', $options['fair_payment_mollie_refresh_token'] );
		$this->assertSame( array( 'payments.read', 'payments.write' ), $options['fair_payment_mollie_scopes'] );
		$this->assertFalse( GrantedScopes::has_settlement_access() );
	}

	/**
	 * #1693: scopes Mollie reports with the refresh replace the recorded ones,
	 * and a rotated refresh token is stored with the new access token.
	 */
	public function test_refresh_with_scope_replaces_recorded_scopes_and_stores_rotated_refresh_token() {
		$this->seed_expired_connection(
			array(
				'access_token'  => 'access_new',
				'expires_in'    => 3600,
				'refresh_token' => 'refresh_new',
				'scope'         => 'payments.read settlements.read',
			)
		);

		new MolliePaymentHandler();

		$options = $GLOBALS['_fair_test_options'];
		$this->assertSame( 'access_new', $options['fair_payment_mollie_access_token'] );
		$this->assertSame( 'refresh_new', $options['fair_payment_mollie_refresh_token'] );
		$this->assertSame( array( 'payments.read', 'settlements.read' ), $options['fair_payment_mollie_scopes'] );
		$this->assertTrue( GrantedScopes::has_settlement_access() );
	}

	/**
	 * #1693: a refresh reporting a narrower grant removes settlement access.
	 */
	public function test_refresh_with_narrower_scope_removes_settlement_access() {
		$this->seed_expired_connection(
			array(
				'access_token' => 'access_new',
				'expires_in'   => 3600,
				'scope'        => 'payments.read',
			)
		);
		$GLOBALS['_fair_test_options']['fair_payment_mollie_scopes'] = array( 'payments.read', 'settlements.read' );

		new MolliePaymentHandler();

		$this->assertSame( array( 'payments.read' ), $GLOBALS['_fair_test_options']['fair_payment_mollie_scopes'] );
		$this->assertFalse( GrantedScopes::has_settlement_access() );
	}

	/**
	 * Regression lock for #1209: a Mollie API error must surface as a typed
	 * PaymentGatewayException carrying a sanitized PaymentGatewayError — never
	 * as a raw \Exception whose message embeds the request body/IDs/URLs.
	 */
	public function test_create_payment_throws_payment_gateway_exception_on_api_error() {
		$mollie = MollieApiClient::fake(
			array(
				CreatePaymentRequest::class => MockResponse::unprocessableEntity( 'The payment method is not activated on your account.' ),
			)
		);

		$handler = new MolliePaymentHandler( $mollie );

		try {
			$handler->create_payment( array( 'amount' => '10.00' ) );
			$this->fail( 'Expected PaymentGatewayException was not thrown.' );
		} catch ( PaymentGatewayException $e ) {
			$this->assertInstanceOf( PaymentGatewayError::class, $e->get_error() );
			// The exception's own message (e.g. surfaced by an uncaught-exception
			// handler/logger elsewhere) must not carry the gateway dump either.
			$this->assertStringNotContainsString( 'Request body', $e->getMessage() );
			$this->assertStringNotContainsString( 'redirectUrl', $e->getMessage() );
		}
	}

	/**
	 * The full technical detail (including the request body) must still reach
	 * the payment log — it moves there exclusively instead of the thrown
	 * exception, it doesn't disappear.
	 */
	public function test_create_payment_logs_full_detail_on_api_error() {
		$mollie = MollieApiClient::fake(
			array(
				CreatePaymentRequest::class => MockResponse::unprocessableEntity( 'The payment method is not activated on your account.' ),
			)
		);

		$handler = new MolliePaymentHandler( $mollie );

		try {
			$handler->create_payment(
				array(
					'amount'   => '10.00',
					'metadata' => array( 'transaction_id' => 7 ),
				)
			);
		} catch ( PaymentGatewayException $e ) {
			unset( $e );
		}

		$logged_rows = $GLOBALS['wpdb']->inserted_rows;
		$failure_row = current(
			array_filter( $logged_rows, static fn( $row ) => 'mollie_call_failed' === $row['event'] )
		);

		$this->assertNotFalse( $failure_row, 'Expected a mollie_call_failed log row.' );
		$this->assertSame( 'error', $failure_row['level'] );
		$this->assertSame( 7, $failure_row['transaction_id'] );
		$this->assertStringContainsString( 'not activated', $failure_row['message'] );

		$context = json_decode( $failure_row['context'], true );
		$this->assertStringContainsString( 'not activated', $context['exception_message'] );
	}
}
