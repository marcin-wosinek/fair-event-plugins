<?php
/**
 * Minimal fake WP_Error for PHPUnit bootstrap.
 *
 * @package FairPaymentsConnector
 */

if ( class_exists( 'WP_Error' ) ) {
	return;
}

/**
 * Minimal stub of WordPress' WP_Error, enough for PaymentGatewayError tests
 * to assert on code/message/data without a full WP bootstrap.
 */
class WP_Error {

	/**
	 * Error code.
	 *
	 * @var string
	 */
	private $code;

	/**
	 * Error message.
	 *
	 * @var string
	 */
	private $message;

	/**
	 * Error data.
	 *
	 * @var mixed
	 */
	private $data;

	/**
	 * Constructor.
	 *
	 * @param string $code    Error code.
	 * @param string $message Error message.
	 * @param mixed  $data    Optional error data.
	 */
	public function __construct( $code = '', $message = '', $data = null ) {
		$this->code    = $code;
		$this->message = $message;
		$this->data    = $data;
	}

	/**
	 * Get the error code.
	 *
	 * @return string
	 */
	public function get_error_code() {
		return $this->code;
	}

	/**
	 * Get the error message.
	 *
	 * @return string
	 */
	public function get_error_message() {
		return $this->message;
	}

	/**
	 * Get the error data.
	 *
	 * @return mixed
	 */
	public function get_error_data() {
		return $this->data;
	}
}
