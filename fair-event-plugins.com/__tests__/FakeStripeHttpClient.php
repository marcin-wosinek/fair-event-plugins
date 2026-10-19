<?php
/**
 * Recording Stripe transport for tests.
 *
 * @package MarcinWosinek\FairEventPluginsCom
 */

namespace MarcinWosinek\FairEventPluginsCom\Tests;

use Stripe\HttpClient\ClientInterface;
use Stripe\Util\CaseInsensitiveArray;

/**
 * Stands in for the SDK's curl client: records each request and replays a
 * queued response, so the real StripeClient runs without network calls.
 */
class FakeStripeHttpClient implements ClientInterface {

	/**
	 * Recorded requests.
	 *
	 * @var array<int, array<string, mixed>>
	 */
	public $requests = array();

	/**
	 * Queued responses: [ status, body array ].
	 *
	 * @var array<int, array{0:int,1:array}>
	 */
	private $responses = array();

	/**
	 * Queue a response.
	 *
	 * @param int   $status HTTP status.
	 * @param array $body   Decoded JSON body.
	 * @return self
	 */
	public function respond( int $status, array $body ): self {
		$this->responses[] = array( $status, $body );
		return $this;
	}

	/**
	 * Record the request and return the next queued response.
	 *
	 * @param string   $method            HTTP method.
	 * @param string   $abs_url           Absolute URL.
	 * @param array    $headers           Header lines.
	 * @param array    $params            Request parameters.
	 * @param bool     $has_file          Whether a file is uploaded.
	 * @param string   $api_mode          Stripe API mode.
	 * @param int|null $max_network_retries Retry limit.
	 * @return array{0:string,1:int,2:CaseInsensitiveArray}
	 * @throws \LogicException When no response is queued.
	 */
	public function request( $method, $abs_url, $headers, $params, $has_file, $api_mode = 'v1', $max_network_retries = null ) {
		$header_map = array();
		foreach ( $headers as $line ) {
			list( $name, $value )              = array_map( 'trim', explode( ':', $line, 2 ) );
			$header_map[ strtolower( $name ) ] = $value;
		}

		$this->requests[] = array(
			'method'  => $method,
			'url'     => $abs_url,
			'headers' => $header_map,
			'params'  => $params,
		);

		if ( ! $this->responses ) {
			throw new \LogicException( "Unexpected Stripe request: {$method} {$abs_url}" ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Test failure message.
		}
		list( $status, $body ) = array_shift( $this->responses );

		return array(
			json_encode( $body ), // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- Not a WordPress runtime.
			$status,
			new CaseInsensitiveArray( array( 'request-id' => 'req_fake' ) ),
		);
	}
}
