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
use FairPaymentsConnector\Database\PaymentLogRepository;
use Mollie\Api\MollieApiClient;
use Mollie\Api\Fake\MockResponse;
use Mollie\Api\Http\PendingRequest;
use Mollie\Api\Http\Requests\CreatePaymentRequest;
use Mollie\Api\Http\Requests\GetPaymentRequest;
use Mollie\Api\Http\Requests\GetEnabledMethodsRequest;
use Mollie\Api\Resources\Payment;
use Mollie\Api\Resources\MethodCollection;

/**
 * Unit tests for MolliePaymentHandler's test/live mode handling.
 */
class MolliePaymentHandlerTest extends TestCase {

	/**
	 * Reset shared test state before each test.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
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
}
