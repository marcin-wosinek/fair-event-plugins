<?php
/**
 * Local Polylang function stubs for @runInSeparateProcess tests.
 *
 * Records calls into $GLOBALS so a test can assert on registration args
 * and drive translated output, without pulling in the real plugin. Only
 * required by tests that need Polylang to appear "active" — never loaded
 * in the main PHPUnit process, so it can't leak into tests that assert on
 * the Polylang-absent fallback behavior.
 *
 * @package FairEventsExperimental
 */

$GLOBALS['_fair_pll_registered_strings'] = array();
$GLOBALS['_fair_pll_translations']       = array();

if ( ! function_exists( 'pll_register_string' ) ) {
	/**
	 * Stub for Polylang's pll_register_string() — records the call.
	 *
	 * @param string $name  String name.
	 * @param string $value String value.
	 * @param string $group String group.
	 * @return void
	 */
	function pll_register_string( $name, $value, $group = 'Polylang' ) {
		$GLOBALS['_fair_pll_registered_strings'][ $name ] = array(
			'string' => $value,
			'group'  => $group,
		);
	}
}

if ( ! function_exists( 'pll__' ) ) {
	/**
	 * Stub for Polylang's pll__() — returns a mapped translation when one
	 * was set on $GLOBALS['_fair_pll_translations'], else the original
	 * value unchanged.
	 *
	 * @param string $value Original string.
	 * @return string
	 */
	function pll__( $value ) {
		return $GLOBALS['_fair_pll_translations'][ $value ] ?? $value;
	}
}
