<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairPlatform
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Define WordPress constants if not already defined.
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', '/tmp/wordpress/' );
}

if ( ! function_exists( 'add_query_arg' ) ) {
	/**
	 * Stub of WordPress add_query_arg() for the array/url form. Like the
	 * real function, it appends values as given, without encoding them.
	 *
	 * @param array  $args Query args to append.
	 * @param string $url  Base URL.
	 * @return string
	 */
	function add_query_arg( $args, $url ) {
		$pairs = array();
		foreach ( $args as $key => $value ) {
			$pairs[] = $key . '=' . $value;
		}
		$separator = false === strpos( $url, '?' ) ? '?' : '&';
		return $url . $separator . implode( '&', $pairs );
	}
}
