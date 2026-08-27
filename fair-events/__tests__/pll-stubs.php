<?php
/**
 * Local Polylang function stubs for @runInSeparateProcess tests.
 *
 * Records calls into $GLOBALS so a test can assert on which post/language
 * pairs were resolved and drive translated output, without pulling in the
 * real plugin. Only required by tests that need Polylang to appear
 * "active" — never loaded in the main PHPUnit process, so it can't leak
 * into tests that assert on the Polylang-absent fallback behavior.
 *
 * @package FairEvents
 */

$GLOBALS['_fair_pll_current_language']   = null;
$GLOBALS['_fair_pll_translated_posts']   = array();
$GLOBALS['_fair_pll_get_post_calls']     = array();
$GLOBALS['_fair_pll_translation_groups'] = array();
$GLOBALS['_fair_pll_posts']              = array();

if ( ! function_exists( 'get_post' ) ) {
	/**
	 * Minimal get_post() stub for Polylang synchronization tests.
	 *
	 * @param int $post_id Post ID.
	 * @return object|null Configured post.
	 */
	function get_post( $post_id ) {
		return $GLOBALS['_fair_pll_posts'][ (int) $post_id ] ?? null;
	}
}

if ( ! function_exists( 'pll_current_language' ) ) {
	/**
	 * Stub for Polylang's pll_current_language() — returns whatever the
	 * test seeded on $GLOBALS['_fair_pll_current_language'].
	 *
	 * @return string|null
	 */
	function pll_current_language() {
		return $GLOBALS['_fair_pll_current_language'];
	}
}

if ( ! function_exists( 'pll_get_post_translations' ) ) {
	/**
	 * Stub for Polylang's translation-group resolver.
	 *
	 * @param int $post_id Post ID.
	 * @return mixed Configured translation result.
	 */
	function pll_get_post_translations( $post_id ) {
		return $GLOBALS['_fair_pll_translation_groups'][ (int) $post_id ] ?? array( 'current' => (int) $post_id );
	}
}

if ( ! function_exists( 'pll_get_post' ) ) {
	/**
	 * Stub for Polylang's pll_get_post() — resolves through the
	 * "{post_id}:{language}" map on $GLOBALS['_fair_pll_translated_posts'],
	 * recording every call so tests can assert on cache behavior.
	 *
	 * @param int    $post_id  Original post ID.
	 * @param string $language Target language slug.
	 * @return int|false Translated post ID, or false when none is mapped.
	 */
	function pll_get_post( $post_id, $language ) {
		$GLOBALS['_fair_pll_get_post_calls'][] = $post_id . ':' . $language;

		$key = $post_id . ':' . $language;
		return $GLOBALS['_fair_pll_translated_posts'][ $key ] ?? false;
	}
}
