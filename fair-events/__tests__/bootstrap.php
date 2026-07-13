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

if ( ! function_exists( 'get_permalink' ) ) {
	/**
	 * Stub of WordPress get_permalink() — deterministic URL from a post ID.
	 *
	 * @param int $post_id Post ID.
	 * @return string Fake permalink.
	 */
	function get_permalink( $post_id ) {
		return 'https://example.com/?p=' . (int) $post_id;
	}
}

if ( ! function_exists( 'get_the_title' ) ) {
	/**
	 * Stub of WordPress get_the_title() — deterministic title from a post ID.
	 *
	 * @param int $post_id Post ID.
	 * @return string Fake title.
	 */
	function get_the_title( $post_id ) {
		return 'Post ' . (int) $post_id;
	}
}

if ( ! function_exists( 'add_query_arg' ) ) {
	/**
	 * Minimal stub of WordPress add_query_arg() for a single key/value pair.
	 *
	 * @param string $key   Query arg name.
	 * @param mixed  $value Query arg value.
	 * @param string $url   URL to append to.
	 * @return string Decorated URL.
	 */
	function add_query_arg( $key, $value, $url ) {
		$separator = ( false === strpos( $url, '?' ) ) ? '?' : '&';
		return $url . $separator . rawurlencode( $key ) . '=' . rawurlencode( $value );
	}
}
