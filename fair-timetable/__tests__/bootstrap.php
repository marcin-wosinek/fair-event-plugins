<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairTimetable
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

if ( ! function_exists( 'plugin_dir_path' ) ) {
	/**
	 * Stub of WordPress plugin_dir_path().
	 *
	 * @param string $file File path.
	 * @return string Directory with a trailing slash.
	 */
	function plugin_dir_path( $file ) {
		return rtrim( dirname( $file ), '/' ) . '/';
	}
}
