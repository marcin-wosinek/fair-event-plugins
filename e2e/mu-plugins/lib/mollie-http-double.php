<?php
/**
 * Fake Mollie HTTP transport for E2E tests.
 *
 * The Mollie PHP SDK's adapter picker does `new CurlMollieHttpAdapter()` when no
 * HTTP client is injected. By declaring that exact class here — before the
 * vendored `final class` is autoloaded — every Mollie API call is served by this
 * double instead of hitting the network. The rest of the SDK (URL building,
 * response decoding, resource hydration) and ALL of the fair-payment /
 * fair-audience code runs unchanged.
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

namespace Mollie\Api\HttpAdapter;

// If the real adapter somehow loaded first, don't redeclare.
if ( class_exists( __NAMESPACE__ . '\\CurlMollieHttpAdapter', false ) ) {
	return;
}

/**
 * Drop-in stand-in for the SDK's cURL adapter. Intentionally does not implement
 * MollieHttpAdapterInterface (the interface may not be autoloadable this early);
 * the SDK only calls send()/versionString() and enforces no type.
 */
class CurlMollieHttpAdapter {

	/**
	 * Serve a canned response for a Mollie API request.
	 *
	 * @param string       $http_method HTTP verb.
	 * @param string       $url         Full request URL.
	 * @param string|array $headers     Request headers (ignored).
	 * @param string       $http_body   JSON request body.
	 * @return \stdClass|null Decoded response body, or null for no content.
	 */
	public function send( $http_method, $url, $headers, $http_body ) {
		$path    = (string) \wp_parse_url( $url, PHP_URL_PATH );
		$payload = ! empty( $http_body ) ? \json_decode( $http_body, true ) : array();
		$payload = \is_array( $payload ) ? $payload : array();

		// Create payment: POST /v2/payments
		if ( 'POST' === \strtoupper( $http_method ) && \preg_match( '#/payments/?$#', $path ) ) {
			return $this->payment_response( $payload, 'open' );
		}

		// Get single payment: GET /v2/payments/{id}
		if ( \preg_match( '#/payments/([^/]+)$#', $path, $m ) ) {
			return $this->payment_response( $payload, 'paid', $m[1] );
		}

		// Payment methods allowlist lookup: GET /v2/methods
		if ( \preg_match( '#/methods#', $path ) ) {
			return $this->objectify(
				array(
					'count'     => 0,
					'_embedded' => array( 'methods' => array() ),
					'_links'    => new \stdClass(),
				)
			);
		}

		// Balance / balance-transactions lookup used by fee capture.
		if ( \preg_match( '#/balances|/balance-transactions#', $path ) ) {
			return $this->objectify(
				array(
					'count'     => 0,
					'_embedded' => array( 'balance_transactions' => array() ),
					'_links'    => array( 'next' => null ),
				)
			);
		}

		return new \stdClass();
	}

	/**
	 * The version string the SDK uses to build its User-Agent header.
	 *
	 * @return string
	 */
	public function versionString() {
		return 'FairEventsE2EMock/1.0';
	}

	/**
	 * Build a Mollie payment response object.
	 *
	 * @param array       $payload Decoded request body (create only).
	 * @param string      $status  Payment status to report.
	 * @param string|null $id      Existing payment id (get) or null to mint one.
	 * @return \stdClass
	 */
	private function payment_response( $payload, $status, $id = null ) {
		$id           = $id ? $id : 'tr_' . \strtoupper( \substr( \md5( \uniqid( '', true ) ), 0, 10 ) );
		$redirect_url = isset( $payload['redirectUrl'] ) ? $payload['redirectUrl'] : \home_url( '/' );
		$amount       = isset( $payload['amount'] ) && \is_array( $payload['amount'] )
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
			'description' => isset( $payload['description'] ) ? $payload['description'] : 'E2E payment',
			'metadata'    => isset( $payload['metadata'] ) ? $payload['metadata'] : new \stdClass(),
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

		return $this->objectify( $data );
	}

	/**
	 * Convert a nested array into the nested stdClass the SDK expects from a
	 * decoded JSON body.
	 *
	 * @param array $data Response data.
	 * @return \stdClass
	 */
	private function objectify( $data ) {
		return \json_decode( \json_encode( $data ) );
	}
}
