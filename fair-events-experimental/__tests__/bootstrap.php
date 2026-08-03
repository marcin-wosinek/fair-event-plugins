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
