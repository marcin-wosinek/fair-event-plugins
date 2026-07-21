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

/**
 * Unit tests for MolliePaymentHandler's test/live mode handling.
 */
class MolliePaymentHandlerTest extends TestCase {

	/**
	 * Reset shared test state before each test.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']    = array();
		$GLOBALS['_fair_test_transients'] = array();
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
	 * `fair_payment_mode = test` must set `testmode = true` on the create request.
	 */
	public function test_create_payment_in_test_mode_sets_testmode_true() {
		$GLOBALS['_fair_test_options']['fair_payment_mode'] = 'test';

		$mollie = MollieApiClient::fake(
			array(
				CreatePaymentRequest::class => MockResponse::resource( Payment::class )
					->with(
						array(
							'id'     => 'tr_test_1',
							'status' => 'open',
						)
					)->create(),
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
				CreatePaymentRequest::class => MockResponse::resource( Payment::class )
					->with(
						array(
							'id'     => 'tr_live_1',
							'status' => 'open',
						)
					)->create(),
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
				CreatePaymentRequest::class => MockResponse::resource( Payment::class )
					->with(
						array(
							'id'     => 'tr_test_2',
							'status' => 'open',
						)
					)->create(),
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
				CreatePaymentRequest::class => MockResponse::resource( Payment::class )
					->with(
						array(
							'id'     => 'tr_oauth_1',
							'status' => 'open',
						)
					)->create(),
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
	 * The method-allowlist lookup must query with the same testmode as the
	 * create call — one source of truth for a single checkout attempt.
	 */
	public function test_method_allowlist_uses_same_testmode_as_create() {
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected']  = true;
		$GLOBALS['_fair_test_options']['fair_payment_mollie_profile_id'] = 'pfl_test123';
		$GLOBALS['_fair_test_options']['fair_payment_mode']              = 'test';

		$mollie = MollieApiClient::fake(
			array(
				CreatePaymentRequest::class     => MockResponse::resource( Payment::class )
					->with(
						array(
							'id'     => 'tr_allowlist_1',
							'status' => 'open',
						)
					)->create(),
				GetEnabledMethodsRequest::class => MockResponse::list( MethodCollection::class )
					->add(
						array(
							'id'       => 'ideal',
							'resource' => 'method',
						)
					)
					->add(
						array(
							'id'       => 'banktransfer',
							'resource' => 'method',
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
				GetPaymentRequest::class => MockResponse::resource( Payment::class )
					->with(
						array(
							'id'     => 'tr_get_1',
							'status' => 'paid',
						)
					)->create(),
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
