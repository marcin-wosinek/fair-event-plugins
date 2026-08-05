<?php
/**
 * Minimal WP_REST_Response stub for PHPUnit, kept in its own file since a
 * PHP file can't mix multiple object structure declarations under phpcs's
 * file-content sniff.
 *
 * @package FairEvents
 */

if ( ! class_exists( 'WP_REST_Response' ) ) {
	/**
	 * Minimal stub of WP_REST_Response — just enough to assert on the data and
	 * status a controller method returned.
	 */
	class WP_REST_Response {

		/**
		 * Response data.
		 *
		 * @var mixed
		 */
		public $data;

		/**
		 * HTTP status code.
		 *
		 * @var int
		 */
		public $status;

		/**
		 * Constructor.
		 *
		 * @param mixed $data   Response data.
		 * @param int   $status HTTP status code.
		 */
		public function __construct( $data = null, $status = 200 ) {
			$this->data   = $data;
			$this->status = $status;
		}

		/**
		 * Get the response data.
		 *
		 * @return mixed
		 */
		public function get_data() {
			return $this->data;
		}

		/**
		 * Get the HTTP status code.
		 *
		 * @return int
		 */
		public function get_status() {
			return $this->status;
		}
	}
}
