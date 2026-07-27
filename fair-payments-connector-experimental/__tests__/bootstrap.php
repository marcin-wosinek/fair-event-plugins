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
