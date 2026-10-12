<?php
/**
 * Fake Mollie HTTP transport for E2E tests.
 *
 * The Mollie PHP SDK v3's adapter picker instantiates CurlMollieHttpAdapter
 * from the Mollie\Api\Http\Adapter namespace when no HTTP client is injected.
 * By declaring that exact class here — before the vendored `final class` is
 * autoloaded — every Mollie API call is served by this double instead of
 * hitting the network. The rest of the SDK (URL building, response decoding,
 * resource hydration) and ALL of the fair-payments-connector / fair-audience
 * code runs unchanged.
 *
 * Canned behaviour, enough to drive the ticket-purchase flow:
 *   - POST /v2/payments        -> a payment in status "open" whose checkout link
 *                                 points straight back at the redirectUrl, so the
 *                                 buyer lands on the signup callback page. Each
 *                                 one is counted in `fair_e2e_mollie_create_count`;
 *                                 while `fair_e2e_mollie_fail_creates` is above
 *                                 zero it throws instead, as an outage would.
 *   - GET  /v2/payments/{id}   -> the same payment in the status set via the
 *                                 `fair_e2e_mollie_get_status` WP option
 *                                 (default "paid", settable per-test via
 *                                 set-mollie-status.php — see #1244), so the
 *                                 callback page's sync pulls that status and
 *                                 the real fair_payment_paid/fair_payment_failed
 *                                 chain fires accordingly.
 *   - GET  /v2/methods         -> empty list (method allowlist stays unset).
 *   - GET  /v2/balances...     -> empty list (fee capture finds nothing).
 *   - GET  /v2/settlements...  -> three canned settlements over two pages, with
 *                                 their payments, captures, refunds and
 *                                 chargebacks (see settlement_response()).
 *                                 Driven per-test through the
 *                                 `fair_e2e_settlements` option, set by
 *                                 fair-e2e-settlements.php.
 *
 * @package FairEventsE2E
 */

namespace Mollie\Api\Http\Adapter;

// During the initial wp-env setup pass WordPress may load before
// fair-payments-connector is activated (and its Composer autoloader registered).
// Explicitly require the autoloader so the Mollie SDK traits are resolvable.
// If neither path works, bail silently — no Mollie API calls happen during
// initial setup anyway, so the double isn't needed at that point.
$_fpc_autoload = defined( 'WP_PLUGIN_DIR' )
	? WP_PLUGIN_DIR . '/fair-payments-connector/vendor/autoload.php'
	: null;
if ( $_fpc_autoload && file_exists( $_fpc_autoload ) ) {
	require_once $_fpc_autoload;
}
unset( $_fpc_autoload );

if ( ! trait_exists( 'Mollie\\Api\\Traits\\HasDefaultFactories', true ) ) {
	return;
}

use Mollie\Api\Contracts\HttpAdapterContract;
use Mollie\Api\Http\PendingRequest;
use Mollie\Api\Http\Response;
use Mollie\Api\Traits\HasDefaultFactories;

// If the real adapter somehow loaded first, don't redeclare.
if ( class_exists( __NAMESPACE__ . '\\CurlMollieHttpAdapter', false ) ) {
	return;
}

/**
 * Drop-in stand-in for the SDK's cURL adapter (Mollie v3).
 *
 * Implements HttpAdapterContract so the adapter picker accepts it as a valid
 * replacement. HasDefaultFactories provides the factories() method the SDK
 * needs to build PSR-7 requests and responses.
 */
class CurlMollieHttpAdapter implements HttpAdapterContract {
	use HasDefaultFactories;

	/**
	 * Serve a canned PSR-7 response for a Mollie API request.
	 *
	 * @param PendingRequest $pending_request Incoming SDK request.
	 * @return Response
	 */
	public function sendRequest( PendingRequest $pending_request ): Response {
		$psr_request = $pending_request->createPsrRequest();
		$method      = \strtoupper( $pending_request->method() );
		$path        = (string) \wp_parse_url( $pending_request->url(), PHP_URL_PATH );
		$raw_body    = (string) $psr_request->getBody();
		$payload     = ! empty( $raw_body ) ? \json_decode( $raw_body, true ) : array();
		$payload     = \is_array( $payload ) ? $payload : array();

		if ( 'GET' === $method && \preg_match( '#/settlements(/|$)#', $path ) ) {
			\parse_str( (string) $psr_request->getUri()->getQuery(), $query );
			$data = $this->settlement_response( $path, $query );
		} else {
			$data = $this->canned_response( $method, $path, $payload );
		}
		$json = \wp_json_encode( $data );

		$fc = $pending_request->getFactoryCollection();
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie SDK field.
		$psr_response = $fc->responseFactory
			->createResponse( 200 )
			->withHeader( 'Content-Type', 'application/json' )
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie SDK field.
			->withBody( $fc->streamFactory->createStream( $json ) );

		return new Response( $psr_response, $psr_request, $pending_request );
	}

	/**
	 * The version string the SDK uses to build its User-Agent header.
	 *
	 * @return string
	 */
	public function version(): string {
		return 'FairEventsE2EMock/2.0';
	}

	/**
	 * Route a request to its canned response data.
	 *
	 * @param string $method  HTTP verb.
	 * @param string $path    URL path component.
	 * @param array  $payload Decoded request body.
	 * @return array|\stdClass
	 * @throws \RuntimeException When a spec armed a payment creation failure.
	 */
	private function canned_response( string $method, string $path, array $payload ) {
		// Create payment: POST /v2/payments.
		if ( 'POST' === $method && \preg_match( '#/payments/?$#', $path ) ) {
			// A spec can make the next creations fail, as an unreachable
			// provider would (see fair-e2e-checkout-keys.php).
			$failures = (int) \get_option( 'fair_e2e_mollie_fail_creates', 0 );
			if ( $failures > 0 ) {
				\update_option( 'fair_e2e_mollie_fail_creates', $failures - 1, false );
				throw new \RuntimeException( 'E2E: simulated payment provider outage.' );
			}

			\update_option( 'fair_e2e_mollie_create_count', (int) \get_option( 'fair_e2e_mollie_create_count', 0 ) + 1, false );
			\update_option( 'fair_e2e_mollie_last_create_payload', $payload, false );
			return $this->payment_response( $payload, 'open' );
		}

		// Bounded payment listing used by the admin Mollie import flow.
		if ( 'GET' === $method && \preg_match( '#/payments/?$#', $path ) ) {
			$payment           = $this->payment_response( array( 'description' => 'E2E manual Mollie payment' ), 'paid', 'tr_e2emanualimport' );
			$payment['amount'] = array(
				'currency' => 'EUR',
				'value'    => '17.50',
			);
			return array(
				'count'     => 1,
				'_embedded' => array( 'payments' => array( $payment ) ),
				'_links'    => array(
					'next'     => null,
					'previous' => null,
				),
			);
		}

		// Get single payment: GET /v2/payments/{id}. Status is settable via
		// set-mollie-status.php so a spec can drive the return-and-retry flow
		// (default "paid" keeps every pre-existing spec's assumption intact).
		if ( \preg_match( '#/payments/([^/]+)$#', $path, $m ) ) {
			$status = (string) \get_option( 'fair_e2e_mollie_get_status', 'paid' );
			if ( 'tr_e2emanualimport' === $m[1] ) {
				return $this->payment_response(
					array(
						'description' => 'E2E manual Mollie payment',
						'amount'      => array(
							'currency' => 'EUR',
							'value'    => '17.50',
						),
					),
					'paid',
					$m[1]
				);
			}
			return $this->payment_response( array(), $status, $m[1] );
		}

		// Payment methods allowlist lookup: GET /v2/methods.
		if ( \preg_match( '#/methods#', $path ) ) {
			return array(
				'count'     => 0,
				'_embedded' => array( 'methods' => array() ),
				'_links'    => new \stdClass(),
			);
		}

		// Balance / balance-transactions lookup used by fee capture.
		if ( \preg_match( '#/balances|/balance-transactions#', $path ) ) {
			return array(
				'count'     => 0,
				'_embedded' => array( 'balance_transactions' => array() ),
				'_links'    => array( 'next' => null ),
			);
		}

		return new \stdClass();
	}

	/**
	 * Canned settlement data for the saved-settlements specs (#1694).
	 *
	 *   - stl_e2e0003: open, no reference yet, no contents.
	 *   - stl_e2e0002: paid out, no report summary; one payment settled
	 *     through a capture, one payment in USD, a refund and a chargeback.
	 *   - stl_e2e0001: paid out; two payments on separate pages and a report
	 *     summary that adds up to the payout.
	 *
	 * The list returns the first two, then stl_e2e0001 on a second page. The
	 * `fair_e2e_settlements` option steers it: `fail_match` makes any request
	 * whose path and query contain that text fail like an outage, and
	 * `variant: changed` reports a different amount for stl_e2e0001's second
	 * payment. `variant: precise` gives stl_e2e0001 a report with fractional-cent
	 * costs, rates, VAT, a negative rounding line and a period invoice, adding
	 * up to a payout of 36.10; `variant: precise_residual` leaves the rounding
	 * line out, so the report misses the payout by 0.0045. Every request is
	 * counted in `requests`.
	 *
	 * @param string $path  URL path component.
	 * @param array  $query Decoded query string.
	 * @return array
	 * @throws \RuntimeException When a spec armed a failure for this request.
	 */
	private function settlement_response( string $path, array $query ): array {
		$state             = (array) \get_option( 'fair_e2e_settlements', array() );
		$state['requests'] = (int) ( $state['requests'] ?? 0 ) + 1;
		\update_option( 'fair_e2e_settlements', $state, false );

		$from       = isset( $query['from'] ) ? (string) $query['from'] : '';
		$fail_match = (string) ( $state['fail_match'] ?? '' );
		if ( '' !== $fail_match && false !== \strpos( $path . '?from=' . $from, $fail_match ) ) {
			throw new \RuntimeException( 'E2E: simulated settlement provider outage.' );
		}

		$variant  = (string) ( $state['variant'] ?? '' );
		$changed  = 'changed' === $variant;
		$precise  = \in_array( $variant, array( 'precise', 'precise_residual' ), true );
		$money    = static function ( string $value, string $currency = 'EUR' ): array {
			return array(
				'value'    => $value,
				'currency' => $currency,
			);
		};
		$list     = static function ( string $key, array $items, ?string $next = null ): array {
			return array(
				'count'     => \count( $items ),
				'_embedded' => array( $key => $items ),
				'_links'    => array(
					'previous' => null,
					'next'     => null === $next ? null : array( 'href' => 'https://api.mollie.com/v2/' . $key . '?from=' . $next ),
				),
			);
		};
		$movement = static function ( string $kind, string $id, string $amount, string $settled, array $extra = array() ) use ( $money ): array {
			return \array_merge(
				array(
					'resource'         => $kind,
					'id'               => $id,
					'mode'             => 'live',
					'status'           => 'paid',
					'description'      => 'E2E settlement ' . $kind,
					'createdAt'        => '2026-05-01T10:00:00+00:00',
					'amount'           => $money( $amount ),
					'settlementAmount' => $money( $settled ),
					'_links'           => new \stdClass(),
				),
				$extra
			);
		};

		$cost = static function ( string $description, ?string $method, ?int $count, ?array $rate, string $net, ?string $vat, string $gross ) use ( $money ): array {
			return array(
				'description' => $description,
				'method'      => $method,
				'count'       => $count,
				'rate'        => $rate,
				'amountNet'   => $money( $net ),
				'amountVat'   => null === $vat ? null : $money( $vat ),
				'amountGross' => $money( $gross ),
			);
		};

		// Synthetic fractional-cent report: 0.7545 + 1.5300 + 1.3700 + 0.2500 - 0.0045 = 3.9000.
		$precise_costs = array(
			$cost(
				'iDEAL',
				'ideal',
				2,
				array(
					'fixed'      => $money( '0.3118' ),
					'percentage' => null,
				),
				'0.6236',
				'0.1309',
				'0.7545'
			),
			$cost(
				'Credit card',
				'creditcard',
				1,
				array(
					'fixed'      => $money( '0.25' ),
					'percentage' => '1.8',
				),
				'1.2645',
				'0.2655',
				'1.5300'
			),
			$cost(
				'Bancontact',
				'bancontact',
				1,
				array(
					'fixed'      => $money( '0.39' ),
					'percentage' => null,
				),
				'1.1322',
				'0.2378',
				'1.3700'
			),
			$cost(
				'Refunds iDEAL',
				'refund',
				1,
				array(
					'fixed'      => $money( '0.25' ),
					'percentage' => null,
				),
				'0.2500',
				'0.0000',
				'0.2500'
			),
		);
		if ( 'precise' === $variant ) {
			$precise_costs[] = $cost( 'Rounding difference', null, null, null, '-0.0045', null, '-0.0045' );
		}

		$settlements = array(
			'stl_e2e0003' => array(
				'resource'  => 'settlement',
				'id'        => 'stl_e2e0003',
				'reference' => null,
				'createdAt' => '2026-05-20T08:00:00+00:00',
				'settledAt' => null,
				'status'    => 'open',
				'amount'    => $money( '12.00' ),
				'periods'   => new \stdClass(),
				'_links'    => new \stdClass(),
			),
			'stl_e2e0002' => array(
				'resource'  => 'settlement',
				'id'        => 'stl_e2e0002',
				'reference' => 'E2E.2605.02',
				'createdAt' => '2026-05-10T08:00:00+00:00',
				'settledAt' => '2026-05-11T08:00:00+00:00',
				'status'    => 'paidout',
				'amount'    => $money( '50.00' ),
				'periods'   => new \stdClass(),
				'_links'    => new \stdClass(),
			),
			'stl_e2e0001' => array(
				'resource'  => 'settlement',
				'id'        => 'stl_e2e0001',
				'reference' => 'E2E.2605.01',
				'createdAt' => '2026-05-01T08:00:00+00:00',
				'settledAt' => '2026-05-02T08:00:00+00:00',
				'status'    => 'paidout',
				'amount'    => $money( $precise ? '36.10' : ( $changed ? '37.55' : '38.55' ) ),
				'balanceId' => 'bal_e2e0001',
				'invoiceId' => 'inv_e2e0001',
				'periods'   => array(
					'2026' => array(
						'05' => array(
							'invoiceId'        => 'inv_e2e0001',
							'invoiceReference' => '2026.10001',
							'revenue'          => array(
								array(
									'description' => 'iDEAL',
									'method'      => 'ideal',
									'count'       => 2,
									'amountNet'   => $money( $changed ? '39.00' : '40.00' ),
									'amountVat'   => null,
									'amountGross' => $money( $changed ? '39.00' : '40.00' ),
								),
							),
							'costs'            => $precise
								? $precise_costs
								: array(
									array(
										'description' => 'iDEAL',
										'method'      => 'ideal',
										'count'       => 2,
										'amountNet'   => $money( '1.20' ),
										'amountVat'   => $money( '0.25' ),
										'amountGross' => $money( '1.45' ),
									),
								),
						),
					),
				),
				'_links'    => new \stdClass(),
			),
		);

		if ( \preg_match( '#/settlements/?$#', $path ) ) {
			return 'stl_e2e0001' === $from
				? $list( 'settlements', array( $settlements['stl_e2e0001'] ) )
				: $list( 'settlements', array( $settlements['stl_e2e0003'], $settlements['stl_e2e0002'] ), 'stl_e2e0001' );
		}

		if ( \preg_match( '#/settlements/([^/]+)$#', $path, $m ) ) {
			if ( ! isset( $settlements[ $m[1] ] ) ) {
				throw new \RuntimeException( 'E2E: unknown settlement.' );
			}
			return $settlements[ $m[1] ];
		}

		if ( ! \preg_match( '#/settlements/([^/]+)/(payments|captures|refunds|chargebacks)$#', $path, $m ) ) {
			throw new \RuntimeException( 'E2E: unsupported settlement request.' );
		}

		$contents = array(
			'stl_e2e0001' => array(
				'payments' => 'tr_e2estl01b' === $from
					? $list( 'payments', array( $movement( 'payment', 'tr_e2estl01b', '15.00', $changed ? '14.00' : '15.00' ) ) )
					: $list( 'payments', array( $movement( 'payment', 'tr_e2estl01a', '25.00', '25.00' ) ), 'tr_e2estl01b' ),
			),
			'stl_e2e0002' => array(
				'payments'    => $list(
					'payments',
					array(
						$movement( 'payment', 'tr_e2estl02a', '30.00', '30.00' ),
						$movement( 'payment', 'tr_e2estl02b', '40.00', '36.80', array( 'amount' => $money( '40.00', 'USD' ) ) ),
					)
				),
				'captures'    => $list( 'captures', array( $movement( 'capture', 'cpt_e2estl02a', '30.00', '30.00', array( 'paymentId' => 'tr_e2estl02a' ) ) ) ),
				'refunds'     => $list( 'refunds', array( $movement( 'refund', 're_e2estl02a', '10.00', '-10.00', array( 'paymentId' => 'tr_e2estl02b' ) ) ) ),
				'chargebacks' => $list( 'chargebacks', array( $movement( 'chargeback', 'chb_e2estl02a', '6.80', '-6.80', array( 'paymentId' => 'tr_e2estl02b' ) ) ) ),
			),
		);

		return $contents[ $m[1] ][ $m[2] ] ?? $list( $m[2], array() );
	}

	/**
	 * Build a Mollie payment response array.
	 *
	 * @param array       $payload Decoded request body (create only).
	 * @param string      $status  Payment status to report.
	 * @param string|null $id      Existing payment id (get) or null to mint one.
	 * @return array
	 */
	private function payment_response( array $payload, string $status, ?string $id = null ): array {
		$id           = $id ?? 'tr_' . \strtoupper( \substr( \md5( \uniqid( '', true ) ), 0, 10 ) );
		$redirect_url = $payload['redirectUrl'] ?? \home_url( '/' );
		$amount       = ( isset( $payload['amount'] ) && \is_array( $payload['amount'] ) )
			? $payload['amount']
			: array(
				'currency' => 'EUR',
				'value'    => '0.00',
			);

		$data = array(
			'resource'    => 'payment',
			'id'          => $id,
			'mode'        => 'test',
			'status'      => $status,
			'amount'      => $amount,
			'description' => $payload['description'] ?? 'E2E payment',
			'metadata'    => $payload['metadata'] ?? new \stdClass(),
			'createdAt'   => \gmdate( 'c' ),
			'_links'      => array(
				'checkout' => array(
					'href' => $redirect_url,
					'type' => 'text/html',
				),
			),
		);

		if ( 'paid' === $status ) {
			$data['paidAt'] = \gmdate( 'c' );
		}

		return $data;
	}
}
