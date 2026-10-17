<?php
/**
 * Recording stub of WordPress's _prime_post_caches() for separate-process
 * tests that assert on bulk priming. Never loaded in the main PHPUnit
 * process, where code paths that prime caches skip it.
 *
 * @package FairEvents
 */

$GLOBALS['_fair_prime_post_caches_calls'] = array();

if ( ! function_exists( '_prime_post_caches' ) ) {
	/**
	 * Record the post IDs a caller primed.
	 *
	 * @param int[] $ids               Post IDs.
	 * @param bool  $update_term_cache Whether terms would be primed.
	 * @param bool  $update_meta_cache Whether meta would be primed.
	 * @return void
	 */
	function _prime_post_caches( $ids, $update_term_cache = true, $update_meta_cache = true ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- signature matches WordPress.
		$GLOBALS['_fair_prime_post_caches_calls'][] = array_values( $ids );
	}
}
