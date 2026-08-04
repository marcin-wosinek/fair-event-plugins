<?php
/**
 * Minimal WP_Error stub for PHPUnit, kept in its own file since a PHP file
 * can only declare one class/interface/trait under phpcs's file-content sniff.
 *
 * @package FairEvents
 */

if ( ! class_exists( 'WP_Error' ) ) {
	/**
	 * Minimal stub of WP_Error — enough for code under test to construct one
	 * and for tests to assert its code/message/status.
	 */
	class WP_Error {

		/**
		 * Error code passed to the constructor.
		 *
		 * @var string
		 */
		private $code;

		/**
		 * Error message passed to the constructor.
		 *
		 * @var string
		 */
		private $message;

		/**
		 * Error data passed to the constructor.
		 *
		 * @var mixed
		 */
		private $data;

		/**
		 * Constructor.
		 *
		 * @param string $code    Error code.
		 * @param string $message Error message.
		 * @param mixed  $data    Optional error data (e.g. array( 'status' => 502 )).
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
}
