<?php
/**
 * WordPress stubs the shared-library loader needs beyond the suite bootstrap.
 *
 * Loaded only by SharedLibraryLoaderTest, in its separate processes.
 *
 * @package FairEvents
 */

if ( ! function_exists( 'did_action' ) ) {
	/**
	 * Stub of WordPress did_action() backed by $GLOBALS['_fair_test_did_action'].
	 *
	 * @param string $hook_name Hook name.
	 * @return int
	 */
	function did_action( $hook_name ) {
		return (int) ( $GLOBALS['_fair_test_did_action'][ $hook_name ] ?? 0 );
	}
}

if ( ! function_exists( 'current_user_can' ) ) {
	/**
	 * Stub of WordPress current_user_can() backed by $GLOBALS['_fair_test_caps'].
	 *
	 * @param string $capability Capability.
	 * @return bool
	 */
	function current_user_can( $capability ) {
		return in_array( $capability, $GLOBALS['_fair_test_caps'] ?? array(), true );
	}
}

if ( ! function_exists( 'get_current_screen' ) ) {
	/**
	 * Stub of WordPress get_current_screen() backed by $GLOBALS['_fair_test_screen'].
	 *
	 * @return object|null
	 */
	function get_current_screen() {
		return $GLOBALS['_fair_test_screen'] ?? null;
	}
}

if ( ! function_exists( 'get_file_data' ) ) {
	/**
	 * Stub of WordPress get_file_data() reading `Header: value` lines.
	 *
	 * @param string $file    File.
	 * @param array  $headers Key => header name.
	 * @return array
	 */
	function get_file_data( $file, $headers ) {
		$contents = (string) file_get_contents( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- test stub.
		$data     = array();
		foreach ( $headers as $key => $header ) {
			$data[ $key ] = preg_match( '/^[ \t\/*#@]*' . preg_quote( $header, '/' ) . ':(.*)$/mi', $contents, $match ) ? trim( $match[1] ) : '';
		}
		return $data;
	}
}

if ( ! function_exists( 'is_multisite' ) ) {
	/**
	 * Stub of WordPress is_multisite().
	 *
	 * @return bool
	 */
	function is_multisite() {
		return ! empty( $GLOBALS['_fair_test_multisite'] );
	}
}

if ( ! function_exists( 'get_site_option' ) ) {
	/**
	 * Stub of WordPress get_site_option() backed by $GLOBALS['_fair_test_site_options'].
	 *
	 * @param string $name          Option name.
	 * @param mixed  $default_value Default.
	 * @return mixed
	 */
	function get_site_option( $name, $default_value = false ) {
		return $GLOBALS['_fair_test_site_options'][ $name ] ?? $default_value;
	}
}
