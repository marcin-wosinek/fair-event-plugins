<?php
/**
 * Minimal WP_Error stub for PHPUnit tests
 *
 * @package FairAudience
 */

if ( ! class_exists( 'WP_Error' ) ) {
	/**
	 * Minimal stub of WordPress WP_Error.
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
		 * Constructor.
		 *
		 * @param string $code    Error code.
		 * @param string $message Error message.
		 * @param mixed  $data    Error data (unused by the stub).
		 */
		public function __construct( $code = '', $message = '', $data = '' ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- signature matches WordPress.
			$this->code    = $code;
			$this->message = $message;
		}

		/**
		 * Get the error code.
		 *
		 * @return string The error code.
		 */
		public function get_error_code() {
			return $this->code;
		}

		/**
		 * Get the error message.
		 *
		 * @return string The error message.
		 */
		public function get_error_message() {
			return $this->message;
		}
	}
}
