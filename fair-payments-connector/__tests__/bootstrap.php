<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairPaymentsConnector
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Define WordPress constants if not already defined.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

// Minimal WordPress function stubs so MolliePaymentHandler::create_payment() can be
// driven black-box through its public API without a full WP bootstrap. Tests seed
// option values via $GLOBALS['_fair_test_options'].
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

if ( ! function_exists( 'wp_parse_args' ) ) {
	/**
	 * Stub of WordPress wp_parse_args().
	 *
	 * @param array|object $args     Values to merge with defaults.
	 * @param array        $defaults Defaults.
	 * @return array Merged arguments.
	 */
	function wp_parse_args( $args, $defaults = array() ) {
		$parsed = is_array( $args ) ? $args : (array) $args;
		return array_merge( $defaults, $parsed );
	}
}

if ( ! function_exists( '__' ) ) {
	/**
	 * Stub of WordPress __() — returns the string untranslated.
	 *
	 * @param string $text   Text to translate.
	 * @param string $domain Text domain (unused).
	 * @return string
	 */
	function __( $text, $domain = 'default' ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
		return $text;
	}
}

if ( ! function_exists( 'esc_html__' ) ) {
	/**
	 * Stub of WordPress esc_html__() — returns the string untranslated.
	 *
	 * @param string $text   Text to translate.
	 * @param string $domain Text domain (unused).
	 * @return string
	 */
	function esc_html__( $text, $domain = 'default' ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
		return $text;
	}
}

if ( ! function_exists( 'esc_html' ) ) {
	/**
	 * Stub of WordPress esc_html() — returns the string unescaped.
	 *
	 * @param string $text Text to escape.
	 * @return string
	 */
	function esc_html( $text ) {
		return $text;
	}
}

if ( ! function_exists( 'home_url' ) ) {
	/**
	 * Stub of WordPress home_url().
	 *
	 * @param string $path Path appended to the home URL.
	 * @return string
	 */
	function home_url( $path = '' ) {
		return 'https://example.test' . $path;
	}
}

if ( ! function_exists( 'wp_json_encode' ) ) {
	/**
	 * Stub of WordPress wp_json_encode().
	 *
	 * @param mixed $data Data to encode.
	 * @return string|false
	 */
	function wp_json_encode( $data ) {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode
		return json_encode( $data );
	}
}

if ( ! function_exists( 'get_current_user_id' ) ) {
	/**
	 * Stub of WordPress get_current_user_id() — no logged-in user in tests.
	 *
	 * @return int
	 */
	function get_current_user_id() {
		return 0;
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

if ( ! function_exists( 'sanitize_text_field' ) ) {
	/**
	 * Stub of WordPress sanitize_text_field() — returns the string trimmed.
	 *
	 * @param string $str String to sanitize.
	 * @return string
	 */
	function sanitize_text_field( $str ) {
		return trim( (string) $str );
	}
}

if ( ! function_exists( 'wp_unslash' ) ) {
	/**
	 * Stub of WordPress wp_unslash() — no-op (no magic quotes in tests).
	 *
	 * @param mixed $value Value to unslash.
	 * @return mixed
	 */
	function wp_unslash( $value ) {
		return $value;
	}
}

require_once __DIR__ . '/Fair_Test_WPDB.php';

// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, no real $wpdb exists here.
$GLOBALS['wpdb'] = new Fair_Test_WPDB();
