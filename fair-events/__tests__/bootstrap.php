<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairEvents
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Define WordPress constants if not already defined.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

// Minimal WordPress function stubs so pure settings logic can be unit tested
// without a full WP bootstrap. Tests seed values via $GLOBALS['_fair_test_options'].
if ( ! function_exists( 'sanitize_key' ) ) {
	/**
	 * Stub of WordPress sanitize_key().
	 *
	 * @param string $key Key to sanitize.
	 * @return string Lowercased key stripped to [a-z0-9_-].
	 */
	function sanitize_key( $key ) {
		$key = strtolower( (string) $key );
		return preg_replace( '/[^a-z0-9_\-]/', '', $key );
	}
}

if ( ! function_exists( 'get_option' ) ) {
	/**
	 * Stub of WordPress get_option() backed by $GLOBALS['_fair_test_options'].
	 *
	 * @param string $name          Option name.
	 * @param mixed  $default_value  Value returned when the option is unset.
	 * @return mixed Stored value or the default.
	 */
	function get_option( $name, $default_value = false ) {
		$options = isset( $GLOBALS['_fair_test_options'] ) ? $GLOBALS['_fair_test_options'] : array();
		return array_key_exists( $name, $options ) ? $options[ $name ] : $default_value;
	}
}
