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

// Minimal stubs so Conversions::send_payload()/send_test() can be driven
// black-box, asserting on the outgoing wp_remote_post() request — the
// third-party HTTP boundary where a stray test_event_code would actually
// leak into (or be missing from) a request. Tests seed option values via
// $GLOBALS['_fair_test_options'] and control the simulated Meta response via
// $GLOBALS['_fair_test_remote_post_response']; every call is recorded in
// $GLOBALS['_fair_test_remote_post_requests'].
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

if ( ! function_exists( 'update_option' ) ) {
	/**
	 * Stub of WordPress update_option() backed by $GLOBALS['_fair_test_options'].
	 *
	 * @param string $name  Option name.
	 * @param mixed  $value Value to store.
	 * @return true
	 */
	function update_option( $name, $value ) {
		$GLOBALS['_fair_test_options'][ $name ] = $value;
		return true;
	}
}

if ( ! function_exists( 'wp_remote_post' ) ) {
	/**
	 * Stub of WordPress wp_remote_post(). Records every call and returns the
	 * response the test queued, defaulting to an accepted 200.
	 *
	 * @param string $url  Request URL.
	 * @param array  $args Request args.
	 * @return array|WP_Error
	 */
	function wp_remote_post( $url, $args = array() ) {
		$GLOBALS['_fair_test_remote_post_requests'][] = array(
			'url'  => $url,
			'args' => $args,
		);
		return isset( $GLOBALS['_fair_test_remote_post_response'] )
			? $GLOBALS['_fair_test_remote_post_response']
			: array(
				'response' => array( 'code' => 200 ),
				'body'     => '{}',
			);
	}
}

if ( ! function_exists( 'is_wp_error' ) ) {
	/**
	 * Stub of WordPress is_wp_error().
	 *
	 * @param mixed $thing Value to check.
	 * @return bool
	 */
	function is_wp_error( $thing ) {
		return $thing instanceof WP_Error;
	}
}

if ( ! function_exists( 'wp_remote_retrieve_response_code' ) ) {
	/**
	 * Stub of WordPress wp_remote_retrieve_response_code().
	 *
	 * @param array $response Response array.
	 * @return int
	 */
	function wp_remote_retrieve_response_code( $response ) {
		return (int) ( $response['response']['code'] ?? 0 );
	}
}

if ( ! function_exists( 'wp_remote_retrieve_body' ) ) {
	/**
	 * Stub of WordPress wp_remote_retrieve_body().
	 *
	 * @param array $response Response array.
	 * @return string
	 */
	function wp_remote_retrieve_body( $response ) {
		return (string) ( $response['body'] ?? '' );
	}
}

if ( ! function_exists( 'current_time' ) ) {
	/**
	 * Stub of WordPress current_time() — returns a fixed UTC timestamp so
	 * test history assertions are deterministic.
	 *
	 * @param string $type Format type ('mysql' or anything else for a Unix timestamp).
	 * @param bool   $gmt  Unused; the stub always returns UTC.
	 * @return string|int
	 */
	function current_time( $type, $gmt = false ) {
		unset( $gmt );
		return 'mysql' === $type ? '2026-01-01 00:00:00' : strtotime( '2026-01-01 00:00:00 UTC' );
	}
}

if ( ! function_exists( 'wp_generate_uuid4' ) ) {
	/**
	 * Stub of WordPress wp_generate_uuid4().
	 *
	 * @return string
	 */
	function wp_generate_uuid4() {
		return 'test-uuid-0000-0000-000000000000';
	}
}

require_once __DIR__ . '/Fair_Test_WP_Error.php';
