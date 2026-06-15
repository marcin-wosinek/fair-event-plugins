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
 *                                 buyer lands on the signup callback page.
 *   - GET  /v2/payments/{id}   -> the same payment in status "paid", so the
 *                                 callback page's sync pulls "paid" and the real
 *                                 fair_payment_paid -> signup-confirmation chain
 *                                 fires.
 *   - GET  /v2/methods         -> empty list (method allowlist stays unset).
 *   - GET  /v2/balances...     -> empty list (fee capture finds nothing).
 *
 * @package FairEventsE2E
 */

namespace Mollie\Api\Http\Adapter;

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

		$data = $this->canned_response( $method, $path, $payload );
		$json = \wp_json_encode( $data );

		$fc          = $pending_request->getFactoryCollection();
		$psr_response = $fc->responseFactory
			->createResponse( 200 )
			->withHeader( 'Content-Type', 'application/json' )
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
	 */
	private function canned_response( string $method, string $path, array $payload ) {
		// Create payment: POST /v2/payments
		if ( 'POST' === $method && \preg_match( '#/payments/?$#', $path ) ) {
			return $this->payment_response( $payload, 'open' );
		}

		// Get single payment: GET /v2/payments/{id}
		if ( \preg_match( '#/payments/([^/]+)$#', $path, $m ) ) {
			return $this->payment_response( array(), 'paid', $m[1] );
		}

		// Payment methods allowlist lookup: GET /v2/methods
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
