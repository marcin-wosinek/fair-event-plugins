<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairAudience
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';
require_once __DIR__ . '/wp-error-stub.php';

// Define WordPress constants if not already defined.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

// Minimal WordPress function stubs so pure digest logic can be unit tested
// without a full WP bootstrap. Tests seed values via $GLOBALS['_fair_test_options'].
if ( ! function_exists( 'is_wp_error' ) ) {
	/**
	 * Stub of WordPress is_wp_error().
	 *
	 * @param mixed $thing Value to check.
	 * @return bool Whether $thing is a WP_Error instance.
	 */
	function is_wp_error( $thing ) {
		return $thing instanceof WP_Error;
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

if ( ! function_exists( 'update_option' ) ) {
	/**
	 * Stub of WordPress update_option() backed by $GLOBALS['_fair_test_options'].
	 *
	 * @param string $name  Option name.
	 * @param mixed  $value Value to store.
	 * @return bool Always true.
	 */
	function update_option( $name, $value ) {
		$GLOBALS['_fair_test_options'][ $name ] = $value;
		return true;
	}
}

if ( ! function_exists( 'current_time' ) ) {
	/**
	 * Stub of WordPress current_time(). Always returns UTC 'mysql' format.
	 *
	 * @return string Current time formatted for MySQL.
	 */
	function current_time() {
		return gmdate( 'Y-m-d H:i:s' );
	}
}

if ( ! function_exists( 'wp_timezone' ) ) {
	/**
	 * Stub of WordPress wp_timezone(), always UTC in tests.
	 *
	 * @return DateTimeZone
	 */
	function wp_timezone() {
		return new DateTimeZone( 'UTC' );
	}
}

if ( ! function_exists( 'sanitize_text_field' ) ) {
	/**
	 * Stub of WordPress sanitize_text_field().
	 *
	 * @param string $value Raw value.
	 * @return string Trimmed value with tags stripped.
	 */
	function sanitize_text_field( $value ) {
		return trim( wp_strip_all_tags( (string) $value ) );
	}
}

if ( ! function_exists( 'wp_strip_all_tags' ) ) {
	/**
	 * Stub of WordPress wp_strip_all_tags().
	 *
	 * @param string $value Raw value.
	 * @return string Value with tags removed.
	 */
	function wp_strip_all_tags( $value ) {
		return strip_tags( (string) $value ); // phpcs:ignore WordPress.WP.AlternativeFunctions.strip_tags_strip_tags -- this *is* the wp_strip_all_tags() stub.
	}
}

if ( ! function_exists( 'sanitize_title' ) ) {
	/**
	 * Stub of WordPress sanitize_title().
	 *
	 * @param string $value Raw value.
	 * @return string Lowercased, hyphenated slug.
	 */
	function sanitize_title( $value ) {
		$value = strtolower( trim( (string) $value ) );
		$value = preg_replace( '/[^a-z0-9]+/', '-', $value );
		return trim( $value, '-' );
	}
}

if ( ! function_exists( 'wp_kses_post' ) ) {
	/**
	 * Stub of WordPress wp_kses_post() — passthrough for test purposes.
	 *
	 * @param string $value Raw HTML.
	 * @return string The same HTML, unmodified.
	 */
	function wp_kses_post( $value ) {
		return (string) $value;
	}
}

if ( ! function_exists( 'esc_html' ) ) {
	/**
	 * Stub of WordPress esc_html().
	 *
	 * @param string $value Raw value.
	 * @return string HTML-escaped value.
	 */
	function esc_html( $value ) {
		return htmlspecialchars( (string) $value, ENT_QUOTES );
	}
}

if ( ! function_exists( 'esc_html__' ) ) {
	/**
	 * Stub of WordPress esc_html__().
	 *
	 * @param string $text Text to translate/escape.
	 * @return string HTML-escaped text.
	 */
	function esc_html__( $text ) {
		return esc_html( $text );
	}
}

if ( ! function_exists( 'esc_url' ) ) {
	/**
	 * Stub of WordPress esc_url().
	 *
	 * @param string $url Raw URL.
	 * @return string Escaped URL.
	 */
	function esc_url( $url ) {
		return htmlspecialchars( (string) $url, ENT_QUOTES );
	}
}

if ( ! function_exists( 'wp_parse_url' ) ) {
	/**
	 * Stub of WordPress wp_parse_url() — delegates to PHP's parse_url().
	 *
	 * @param string   $url       URL to parse.
	 * @param int|null $component PHP_URL_* component, or null for all.
	 * @return mixed Parsed component, full array, or false on failure.
	 */
	function wp_parse_url( $url, $component = -1 ) {
		return -1 === $component ? parse_url( $url ) : parse_url( $url, $component ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- this *is* the wp_parse_url() stub.
	}
}

if ( ! function_exists( 'get_site_url' ) ) {
	/**
	 * Stub of WordPress get_site_url() backed by $GLOBALS['_fair_test_options'].
	 *
	 * Seed via `$GLOBALS['_fair_test_options']['siteurl']` to change it; defaults
	 * to 'https://example.test' so internal-vs-external host checks are
	 * deterministic in tests.
	 *
	 * @return string Site URL.
	 */
	function get_site_url() {
		$options = isset( $GLOBALS['_fair_test_options'] ) ? $GLOBALS['_fair_test_options'] : array();
		return isset( $options['siteurl'] ) ? $options['siteurl'] : 'https://example.test';
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
