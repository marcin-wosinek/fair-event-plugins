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
		 * Error message.
		 *
		 * @var string
		 */
		private $message;

		/**
		 * Constructor.
		 *
		 * @param string $code    Error code (unused by the stub).
		 * @param string $message Error message.
		 */
		public function __construct( $code = '', $message = '' ) {
			$this->message = $message;
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
