<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairPlatform
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Define WordPress constants if not already defined.
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', '/tmp/wordpress/' );
}

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

if ( ! function_exists( 'add_query_arg' ) ) {
	/**
	 * Stub of WordPress add_query_arg() for the array/url form. Like the
	 * real function, it appends values as given, without encoding them.
	 *
	 * @param array  $args Query args to append.
	 * @param string $url  Base URL.
	 * @return string
	 */
	function add_query_arg( $args, $url ) {
		$pairs = array();
		foreach ( $args as $key => $value ) {
			$pairs[] = $key . '=' . $value;
		}
		$separator = false === strpos( $url, '?' ) ? '?' : '&';
		return $url . $separator . implode( '&', $pairs );
	}
}
