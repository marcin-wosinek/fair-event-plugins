<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairAudienceExperimental
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Define WordPress constants if not already defined.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

if ( ! function_exists( 'get_option' ) ) {
	/**
	 * Stub of WordPress get_option() backed by $GLOBALS['_fair_test_options'].
	 *
	 * @param string $name          Option name.
	 * @param mixed  $default_value Value when the option is missing.
	 * @return mixed
	 */
	function get_option( $name, $default_value = false ) {
		$options = isset( $GLOBALS['_fair_test_options'] ) ? $GLOBALS['_fair_test_options'] : array();
		return array_key_exists( $name, $options ) ? $options[ $name ] : $default_value;
	}
}

if ( ! function_exists( 'apply_filters' ) ) {
	/**
	 * Stub of WordPress apply_filters(): runs the callback registered in
	 * $GLOBALS['_fair_test_filters'][ $hook_name ], if any.
	 *
	 * @param string $hook_name Filter name.
	 * @param mixed  $value     Value to filter.
	 * @param mixed  ...$args   Extra arguments.
	 * @return mixed
	 */
	function apply_filters( $hook_name, $value, ...$args ) {
		$filters = isset( $GLOBALS['_fair_test_filters'] ) ? $GLOBALS['_fair_test_filters'] : array();
		return isset( $filters[ $hook_name ] ) ? $filters[ $hook_name ]( $value, ...$args ) : $value;
	}
}

if ( ! function_exists( '__' ) ) {
	/**
	 * Stub of WordPress __(): returns the text untranslated.
	 *
	 * @param string $text   Text.
	 * @param string $domain Text domain.
	 * @return string
	 */
	function __( $text, $domain = 'default' ) {
		unset( $domain );
		return $text;
	}
}

if ( ! function_exists( 'wp_salt' ) ) {
	/**
	 * Stub of WordPress wp_salt(): a fixed value for deterministic HMAC
	 * signing. $GLOBALS['_fair_test_salt'] stands in for changed security keys.
	 *
	 * @param string $scheme Salt scheme (ignored).
	 * @return string
	 */
	function wp_salt( $scheme = 'auth' ) {
		unset( $scheme );
		return isset( $GLOBALS['_fair_test_salt'] ) ? $GLOBALS['_fair_test_salt'] : 'test-salt';
	}
}

if ( ! function_exists( 'home_url' ) ) {
	/**
	 * Stub of WordPress home_url().
	 *
	 * @param string $path Path to append.
	 * @return string
	 */
	function home_url( $path = '' ) {
		return 'https://example.com' . $path;
	}
}

if ( ! function_exists( 'add_query_arg' ) ) {
	/**
	 * Stub of WordPress add_query_arg() for a single key/value pair.
	 *
	 * @param string $key   Query arg key.
	 * @param string $value Query arg value.
	 * @param string $url   Base URL.
	 * @return string
	 */
	function add_query_arg( $key, $value, $url ) {
		$separator = false === strpos( $url, '?' ) ? '?' : '&';
		return $url . $separator . http_build_query( array( $key => $value ) );
	}
}

if ( ! class_exists( 'WP_Error' ) ) {
	/**
	 * Minimal stand-in for WordPress WP_Error.
	 */
	// phpcs:ignore Generic.Files.OneObjectStructurePerFile.MultipleFound, Universal.Files.SeparateFunctionsFromOO.Mixed -- test bootstrap.
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
		 * @param string $code    Code.
		 * @param string $message Message.
		 */
		public function __construct( $code = '', $message = '' ) {
			$this->code    = $code;
			$this->message = $message;
		}

		/**
		 * Error code.
		 *
		 * @return string
		 */
		public function get_error_code() {
			return $this->code;
		}

		/**
		 * Error message.
		 *
		 * @return string
		 */
		public function get_error_message() {
			return $this->message;
		}
	}
}
