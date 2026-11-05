<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairForm
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Define WordPress constants if not already defined.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

// Minimal WordPress function stubs for the code under test.
if ( ! function_exists( 'add_filter' ) ) {
	/**
	 * Stub of WordPress add_filter() — tests call callbacks directly, so
	 * registrations are not recorded.
	 *
	 * @return true
	 */
	function add_filter() {
		return true;
	}
}

if ( ! function_exists( 'add_action' ) ) {
	/**
	 * Stub of WordPress add_action() — see the add_filter() stub.
	 *
	 * @return true
	 */
	function add_action() {
		return true;
	}
}

if ( ! function_exists( '__' ) ) {
	/**
	 * Stub of WordPress __().
	 *
	 * @param string $text Text to translate.
	 * @return string The untranslated text.
	 */
	function __( $text ) {
		return $text;
	}
}

if ( ! function_exists( 'get_option' ) ) {
	/**
	 * Stub of WordPress get_option() backed by $GLOBALS['_fair_test_options'].
	 *
	 * @param string $name          Option name.
	 * @param mixed  $default_value Value returned when the option is unset.
	 * @return mixed Stored value or the default.
	 */
	function get_option( $name, $default_value = false ) {
		$options = isset( $GLOBALS['_fair_test_options'] ) ? $GLOBALS['_fair_test_options'] : array();
		return array_key_exists( $name, $options ) ? $options[ $name ] : $default_value;
	}
}

if ( ! function_exists( 'apply_filters' ) ) {
	/**
	 * Stub of WordPress apply_filters() — returns the value unfiltered, unless
	 * a test put a callback for the hook in $GLOBALS['_fair_test_filters'].
	 *
	 * @param string $hook_name Filter name.
	 * @param mixed  $value     Value to filter.
	 * @param mixed  ...$args   Further arguments passed to the callback.
	 * @return mixed
	 */
	function apply_filters( $hook_name, $value, ...$args ) {
		$filters = isset( $GLOBALS['_fair_test_filters'] ) ? $GLOBALS['_fair_test_filters'] : array();
		return isset( $filters[ $hook_name ] ) ? $filters[ $hook_name ]( $value, ...$args ) : $value;
	}
}
