<?php
/**
 * Minimal WordPress class stubs for PHPUnit, kept in their own file since a
 * PHP file can't mix function declarations (bootstrap.php) with OO structure
 * declarations under phpcs's file-content sniff.
 *
 * @package FairEvents
 */

if ( ! class_exists( 'WP_REST_Controller' ) ) {
	/**
	 * Empty stub of WP_REST_Controller — enough for tests that reach a
	 * controller's pure/private methods via Reflection without registering
	 * routes or touching the REST server.
	 */
	class WP_REST_Controller {}
}
