<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairForm
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Define WordPress constants if not already defined.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

// Minimal WordPress function stubs for the code under test.
if ( ! function_exists( 'add_filter' ) ) {
	/**
	 * Stub of WordPress add_filter() — tests call callbacks directly, so
	 * registrations are not recorded.
	 *
	 * @return true
	 */
	function add_filter() {
		return true;
	}
}

if ( ! function_exists( 'add_action' ) ) {
	/**
	 * Stub of WordPress add_action() — see the add_filter() stub.
	 *
	 * @return true
	 */
	function add_action() {
		return true;
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
