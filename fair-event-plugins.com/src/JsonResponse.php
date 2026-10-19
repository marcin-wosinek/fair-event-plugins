<?php
/**
 * JSON response value returned by the onboarding endpoints.
 *
 * @package MarcinWosinek\FairEventPluginsCom
 */

namespace MarcinWosinek\FairEventPluginsCom;

/**
 * Status, body and extra headers of one JSON response.
 */
class JsonResponse {

	/**
	 * HTTP status code.
	 *
	 * @var int
	 */
	public $status;

	/**
	 * Response body.
	 *
	 * @var array<string, string>
	 */
	public $body;

	/**
	 * Extra response headers.
	 *
	 * @var array<string, string>
	 */
	public $headers;

	/**
	 * Constructor.
	 *
	 * @param int                   $status  HTTP status code.
	 * @param array<string, string> $body    Response body.
	 * @param array<string, string> $headers Extra response headers.
	 */
	public function __construct( int $status, array $body, array $headers = array() ) {
		$this->status  = $status;
		$this->body    = $body;
		$this->headers = $headers;
	}

	/**
	 * Generic error response.
	 *
	 * @param int    $status  HTTP status code.
	 * @param string $message Public, non-sensitive message.
	 * @return self
	 */
	public static function error( int $status, string $message ): self {
		return new self( $status, array( 'error' => $message ) );
	}

	/**
	 * Emit the response.
	 */
	public function send(): void {
		http_response_code( $this->status );
		header( 'Content-Type: application/json' );
		header( 'Cache-Control: no-store' );
		foreach ( $this->headers as $name => $value ) {
			header( $name . ': ' . $value );
		}
		echo json_encode( $this->body ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode, WordPress.Security.EscapeOutput.OutputNotEscaped -- Not a WordPress runtime; JSON body.
	}
}
