<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairPaymentsConnectorExperimental
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// WordPress constant stubs.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

if ( ! function_exists( 'esc_html' ) ) {
	/**
	 * Stub of WordPress esc_html() — returns the string unescaped.
	 *
	 * @param string $text Text to escape.
	 * @return string
	 */
	function esc_html( $text ) {
		return (string) $text;
	}
}

if ( ! function_exists( 'esc_url' ) ) {
	/**
	 * Stub of WordPress esc_url() — a no-op pass-through for test input.
	 *
	 * @param string $url URL to sanitize.
	 * @return string Unmodified URL.
	 */
	function esc_url( $url ) {
		return (string) $url;
	}
}

if ( ! function_exists( 'number_format_i18n' ) ) {
	/**
	 * Stub of WordPress number_format_i18n() — delegates to number_format()
	 * since tests run under the default (no locale-specific separators) case.
	 *
	 * @param float $number   Number to format.
	 * @param int   $decimals Number of decimal places.
	 * @return string
	 */
	function number_format_i18n( $number, $decimals = 0 ) {
		return number_format( (float) $number, $decimals );
	}
}
