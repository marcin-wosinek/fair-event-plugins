<?php
/**
 * Mollie settlement provider adapter.
 *
 * Each test injects a faked MollieApiClient with a controlled response and
 * asserts on the outgoing request and on the normalized result.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Payment;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Payment\MollieSettlementProvider;
use FairPaymentsConnector\Payment\SettlementProviderException;
use FairPaymentsConnector\Settlements\Movements;
use Mollie\Api\MollieApiClient;
use Mollie\Api\Fake\MockResponse;
use Mollie\Api\Http\PendingRequest;
use Mollie\Api\Http\Requests\GetPaginatedSettlementsRequest;
use Mollie\Api\Http\Requests\GetSettlementRequest;
use Mollie\Api\Http\Requests\GetPaginatedSettlementPaymentsRequest;
use Mollie\Api\Http\Requests\GetPaginatedSettlementCapturesRequest;
use Mollie\Api\Http\Requests\GetPaginatedSettlementRefundsRequest;
use Mollie\Api\Http\Requests\GetPaginatedSettlementChargebacksRequest;

/**
 * Unit tests for MollieSettlementProvider.
 */
class MollieSettlementProviderTest extends TestCase {

	/**
	 * Reset shared test state before each test.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/**
	 * A Mollie list response.
	 *
	 * @param string      $key   Embedded collection key.
	 * @param array[]     $items Resources.
	 * @param string|null $next  Cursor of the next page.
	 * @return MockResponse
	 */
	private function list_response( $key, array $items, $next = null ) {
		return new MockResponse(
			array(
				'count'     => count( $items ),
				'_embedded' => array( $key => $items ),
				'_links'    => array(
					'self'     => array( 'href' => 'https://api.mollie.com/v2/' . $key ),
					'previous' => null,
					'next'     => $next ? array( 'href' => 'https://api.mollie.com/v2/' . $key . '?from=' . $next . '&limit=2' ) : null,
				),
			)
		);
	}

	/**
	 * A Mollie settlement resource.
	 *
	 * @param array $overrides Fields to change.
	 * @return array
	 */
	private function settlement( array $overrides = array() ) {
		return array_merge(
			array(
				'resource'  => 'settlement',
				'id'        => 'stl_unit0001',
				'reference' => '1234567.2605.01',
				'createdAt' => '2026-05-01T08:00:00+02:00',
				'settledAt' => '2026-05-02T10:00:00+00:00',
				'status'    => 'paidout',
				'amount'    => array(
					'value'    => '38.55',
					'currency' => 'EUR',
				),
				'balanceId' => 'bal_unit0001',
				'invoiceId' => 'inv_unit0001',
				'periods'   => array(
					'2026' => array(
						'05' => array(
							'revenue' => array(
								array(
									'description' => 'iDEAL',
									'method'      => 'ideal',
									'count'       => 2,
									'amountNet'   => array(
										'value'    => '40.00',
										'currency' => 'EUR',
									),
									'amountVat'   => null,
									'amountGross' => array(
										'value'    => '40.00',
										'currency' => 'EUR',
									),
								),
							),
							'costs'   => array(
								array(
									'description' => 'iDEAL',
									'method'      => 'ideal',
									'count'       => 2,
									'amountNet'   => array(
										'value'    => '1.20',
										'currency' => 'EUR',
									),
									'amountVat'   => array(
										'value'    => '0.25',
										'currency' => 'EUR',
									),
									'amountGross' => array(
										'value'    => '1.45',
										'currency' => 'EUR',
									),
								),
							),
						),
					),
				),
				'_links'    => array(),
			),
			$overrides
		);
	}

	/**
	 * Find the request of a class the fake client sent.
	 *
	 * @param MollieApiClient $mollie        Fake client.
	 * @param string          $request_class Request class.
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

	/** Listing asks for one bounded page and returns Mollie's own next cursor. */
	public function test_list_settlements_returns_facts_and_next_cursor() {
		$mollie   = MollieApiClient::fake(
			array(
				GetPaginatedSettlementsRequest::class => $this->list_response( 'settlements', array( $this->settlement() ), 'stl_unit0002' ),
			)
		);
		$provider = new MollieSettlementProvider( $mollie );
		$page     = $provider->list_settlements( 'stl_cursor', 50 );
		$uri      = (string) $this->sent_request( $mollie, GetPaginatedSettlementsRequest::class )->createPsrRequest()->getUri();

		$this->assertStringContainsString( 'from=stl_cursor', $uri );
		$this->assertStringContainsString( 'limit=50', $uri );
		$this->assertSame( 'stl_unit0002', $page['next'] );
		$this->assertSame( 'stl_unit0001', $page['settlements'][0]['provider_id'] );
		$this->assertSame( '1234567.2605.01', $page['settlements'][0]['reference'] );
		$this->assertSame( '38.55', $page['settlements'][0]['amount'] );
		$this->assertSame( 'EUR', $page['settlements'][0]['currency'] );
		$this->assertSame( 'paidout', $page['settlements'][0]['status'] );
		$this->assertSame( '2026-05-01 06:00:00', $page['settlements'][0]['created_at'] );
		$this->assertSame( 'bal_unit0001', $page['settlements'][0]['balance_id'] );
	}

	/** The last page has no next cursor. */
	public function test_last_page_has_no_cursor() {
		$provider = new MollieSettlementProvider(
			MollieApiClient::fake(
				array( GetPaginatedSettlementsRequest::class => $this->list_response( 'settlements', array() ) )
			)
		);

		$this->assertNull( $provider->list_settlements( null, 50 )['next'] );
	}

	/** The report summary is kept as aggregate rows, with costs reducing the payout. */
	public function test_get_settlement_keeps_report_summary_as_aggregates() {
		$provider   = new MollieSettlementProvider(
			MollieApiClient::fake( array( GetSettlementRequest::class => new MockResponse( $this->settlement() ) ) )
		);
		$settlement = $provider->get_settlement( 'stl_unit0001' );

		$this->assertCount( 2, $settlement['aggregates'] );
		$this->assertSame( Movements::TYPE_SUMMARY, $settlement['aggregates'][0]['type'] );
		$this->assertSame( '40.00', $settlement['aggregates'][0]['settlement_amount'] );
		$this->assertSame( Movements::TYPE_FEE, $settlement['aggregates'][1]['type'] );
		$this->assertSame( '-1.45', $settlement['aggregates'][1]['settlement_amount'] );
		$this->assertTrue( $settlement['aggregates'][1]['is_aggregate'] );
		$this->assertNotSame( $settlement['aggregates'][0]['identity_key'], $settlement['aggregates'][1]['identity_key'] );
		$this->assertSame( 'verified', $settlement['summary_check'] );
	}

	/** A summary that does not equal the payout is reported, not hidden. */
	public function test_summary_that_does_not_add_up_is_a_mismatch() {
		$provider = new MollieSettlementProvider(
			MollieApiClient::fake(
				array(
					GetSettlementRequest::class => new MockResponse(
						$this->settlement(
							array(
								'amount' => array(
									'value'    => '99.00',
									'currency' => 'EUR',
								),
							)
						)
					),
				)
			)
		);

		$this->assertSame( 'mismatch', $provider->get_settlement( 'stl_unit0001' )['summary_check'] );
	}

	/** Without a report summary the payout cannot be checked. */
	public function test_summary_check_is_unavailable_without_periods() {
		$provider = new MollieSettlementProvider(
			MollieApiClient::fake(
				array( GetSettlementRequest::class => new MockResponse( $this->settlement( array( 'periods' => array() ) ) ) )
			)
		);

		$settlement = $provider->get_settlement( 'stl_unit0001' );

		$this->assertSame( array(), $settlement['aggregates'] );
		$this->assertSame( 'unavailable', $settlement['summary_check'] );
	}

	/** A response for a different settlement than the one asked for is refused. */
	public function test_get_settlement_refuses_another_settlement() {
		$provider = new MollieSettlementProvider(
			MollieApiClient::fake( array( GetSettlementRequest::class => new MockResponse( $this->settlement( array( 'id' => 'stl_other' ) ) ) ) )
		);

		$this->expectException( SettlementProviderException::class );
		$this->expectExceptionMessage( SettlementProviderException::INVALID_RESPONSE );
		$provider->get_settlement( 'stl_unit0001' );
	}

	/**
	 * Each kind of settlement content and the request that loads it.
	 *
	 * @return array[]
	 */
	public function parts() {
		return array(
			'payments'    => array( 'payments', GetPaginatedSettlementPaymentsRequest::class, 'payments', Movements::TYPE_PAYMENT, 'tr_unit0001' ),
			'captures'    => array( 'captures', GetPaginatedSettlementCapturesRequest::class, 'captures', Movements::TYPE_CAPTURE, 'cpt_unit0001' ),
			'refunds'     => array( 'refunds', GetPaginatedSettlementRefundsRequest::class, 'refunds', Movements::TYPE_REFUND, 're_unit0001' ),
			'chargebacks' => array( 'chargebacks', GetPaginatedSettlementChargebacksRequest::class, 'chargebacks', Movements::TYPE_CHARGEBACK, 'chb_unit0001' ),
		);
	}

	/**
	 * Payments, captures, refunds and chargebacks are each loaded and typed.
	 *
	 * @dataProvider parts
	 *
	 * @param string $part          Part name.
	 * @param string $request_class Request class.
	 * @param string $key           Embedded collection key.
	 * @param string $type          Expected movement type.
	 * @param string $id            Resource ID.
	 */
	public function test_list_movements_loads_each_part( $part, $request_class, $key, $type, $id ) {
		$resource = array(
			'resource'         => rtrim( $key, 's' ),
			'id'               => $id,
			'paymentId'        => 'tr_parent0001',
			'description'      => 'Unit movement',
			'status'           => 'paid',
			'createdAt'        => '2026-05-01T10:00:00+00:00',
			'amount'           => array(
				'value'    => '40.00',
				'currency' => 'USD',
			),
			'settlementAmount' => array(
				'value'    => '36.80',
				'currency' => 'EUR',
			),
			'_links'           => array(),
		);
		$mollie   = MollieApiClient::fake( array( $request_class => $this->list_response( $key, array( $resource ), $id . 'next' ) ) );
		$provider = new MollieSettlementProvider( $mollie );
		$page     = $provider->list_movements( 'stl_unit0001', $part, 'cursor_unit0001', 250 );
		$movement = $page['movements'][0];
		$uri      = (string) $this->sent_request( $mollie, $request_class )->createPsrRequest()->getUri();

		$this->assertStringContainsString( 'stl_unit0001/' . $part, $uri );
		// The cursor and page size must reach Mollie, or the first page repeats.
		$this->assertStringContainsString( 'from=cursor_unit0001', $uri );
		$this->assertStringContainsString( 'limit=250', $uri );
		$this->assertSame( $id . 'next', $page['next'] );
		$this->assertSame( $type, $movement['type'] );
		$this->assertSame( $type . ':' . $id . '#1', $movement['identity_key'] );
		$this->assertSame( Movements::TYPE_PAYMENT === $type ? $id : 'tr_parent0001', $movement['payment_reference'] );
		$this->assertSame( '40.00', $movement['amount'] );
		$this->assertSame( 'USD', $movement['currency'] );
		$this->assertSame( '36.80', $movement['settlement_amount'] );
		$this->assertSame( 'EUR', $movement['settlement_currency'] );
		$this->assertFalse( $movement['needs_review'] );
	}

	/** An amount Mollie sends that cannot be read exactly stays unknown and is flagged. */
	public function test_unreadable_amount_stays_unknown() {
		$provider = new MollieSettlementProvider(
			MollieApiClient::fake(
				array(
					GetPaginatedSettlementPaymentsRequest::class => $this->list_response(
						'payments',
						array(
							array(
								'resource'         => 'payment',
								'id'               => 'tr_unit0002',
								'amount'           => array(
									'value'    => '10.00',
									'currency' => 'EUR',
								),
								'settlementAmount' => array(
									'value'    => 'ten',
									'currency' => 'EUR',
								),
								'_links'           => array(),
							),
						)
					),
				)
			)
		);

		$movement = $provider->list_movements( 'stl_unit0001', 'payments', null, 250 )['movements'][0];

		$this->assertNull( $movement['settlement_amount'] );
		$this->assertTrue( $movement['needs_review'] );
	}

	/** A next cursor equal to the current one is refused instead of looping. */
	public function test_cursor_that_does_not_advance_is_refused() {
		$provider = new MollieSettlementProvider(
			MollieApiClient::fake(
				array( GetPaginatedSettlementPaymentsRequest::class => $this->list_response( 'payments', array(), 'tr_same0001' ) )
			)
		);

		$this->expectException( SettlementProviderException::class );
		$this->expectExceptionMessage( SettlementProviderException::INVALID_RESPONSE );
		$provider->list_movements( 'stl_unit0001', 'payments', 'tr_same0001', 250 );
	}

	/** A missing permission is reported as such, without Mollie's own text. */
	public function test_forbidden_response_is_an_access_problem() {
		$provider = new MollieSettlementProvider(
			MollieApiClient::fake(
				array( GetPaginatedSettlementsRequest::class => MockResponse::error( 403, 'Forbidden', 'Missing scope settlements.read for org_secret' ) )
			)
		);

		try {
			$provider->list_settlements( null, 50 );
			$this->fail( 'The request succeeded.' );
		} catch ( SettlementProviderException $e ) {
			$this->assertSame( SettlementProviderException::ACCESS_DENIED, $e->get_category() );
			$this->assertStringNotContainsString( 'org_secret', $e->getMessage() );
		}
	}

	/** Any other provider failure is a retryable request failure. */
	public function test_server_error_is_a_request_failure() {
		$provider = new MollieSettlementProvider(
			MollieApiClient::fake(
				array( GetSettlementRequest::class => MockResponse::error( 503, 'Service Unavailable', 'Try later' ) )
			)
		);

		try {
			$provider->get_settlement( 'stl_unit0001' );
			$this->fail( 'The request succeeded.' );
		} catch ( SettlementProviderException $e ) {
			$this->assertSame( SettlementProviderException::REQUEST_FAILED, $e->get_category() );
		}
	}

	/** Without a connection the adapter cannot be built. */
	public function test_requires_a_connection() {
		$this->expectException( SettlementProviderException::class );
		$this->expectExceptionMessage( SettlementProviderException::NOT_CONNECTED );
		new MollieSettlementProvider();
	}
}
