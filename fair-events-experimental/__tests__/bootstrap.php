<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairEventsExperimental
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Define WordPress constants if not already defined.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

if ( ! function_exists( 'home_url' ) ) {
	/** Return a stable test site URL. */
	function home_url() {
		return 'https://example.test/';
	}
}

if ( ! function_exists( '__' ) ) {
	/**
	 * Stub for WordPress' translation function — returns the text unchanged.
	 *
	 * @param string $text   Text to translate.
	 * @param string $domain Text domain (unused in the stub).
	 * @return string Untranslated text.
	 */
	function __( $text, $domain = 'default' ) {
		unset( $domain );
		return $text;
	}
}

if ( ! function_exists( 'esc_url_raw' ) ) {
	/**
	 * Stub of WordPress esc_url_raw() — a no-op pass-through for test input.
	 *
	 * @param string $url URL to sanitize.
	 * @return string Unmodified URL.
	 */
	function esc_url_raw( $url ) {
		return (string) $url;
	}
}

if ( ! function_exists( 'wp_json_encode' ) ) {
	/**
	 * Stub of WordPress wp_json_encode() — delegates to json_encode().
	 *
	 * @param mixed $data Data to encode.
	 * @return string|false Encoded JSON.
	 */
	function wp_json_encode( $data ) {
		return json_encode( $data ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- test-only stub.
	}
}

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
