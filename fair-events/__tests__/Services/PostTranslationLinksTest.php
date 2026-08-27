<?php
/**
 * PostTranslationLinks tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\PostTranslationLinks;
use PHPUnit\Framework\TestCase;

/**
 * Covers defensive Polylang translation-group resolution.
 */
class PostTranslationLinksTest extends TestCase {
	/**
	 * Polylang-unavailable behavior is a singleton group.
	 *
	 * @return void
	 */
	public function test_resolve_group_without_polylang_returns_requested_post() {
		$this->assertSame( array( 42 ), PostTranslationLinks::resolve_group( 42 ) );
		$this->assertSame( array(), PostTranslationLinks::resolve_group( 0 ) );
	}

	/**
	 * Normalizes IDs, removes duplicates, and keeps the request first.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 * @return void
	 */
	public function test_resolve_group_normalizes_complete_polylang_result() {
		require dirname( __DIR__ ) . '/pll-stubs.php';
		$GLOBALS['_fair_pll_translation_groups'][42] = array(
			'en'      => '41',
			'fr'      => 42,
			'es'      => 43,
			'dupe'    => '43',
			'invalid' => 0,
		);

		$this->assertSame( array( 42, 41, 43 ), PostTranslationLinks::resolve_group( 42 ) );
	}

	/**
	 * Missing and malformed Polylang results retain singleton behavior.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 * @return void
	 */
	public function test_resolve_group_handles_malformed_or_incomplete_results() {
		require dirname( __DIR__ ) . '/pll-stubs.php';
		$GLOBALS['_fair_pll_translation_groups'][42] = false;
		$this->assertSame( array( 42 ), PostTranslationLinks::resolve_group( 42 ) );

		$GLOBALS['_fair_pll_translation_groups'][42] = array(
			'fr'      => 43,
			'invalid' => 'not-an-id',
		);
		$this->assertSame( array( 42, 43 ), PostTranslationLinks::resolve_group( 42 ) );
	}

	/**
	 * An already-active group returns before attempting any link mutations.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 * @return void
	 */
	public function test_saved_post_sync_has_group_reentrancy_protection() {
		require dirname( __DIR__ ) . '/pll-stubs.php';
		$GLOBALS['_fair_pll_posts'][42]              = (object) array(
			'ID'        => 42,
			'post_type' => 'fair_event',
		);
		$GLOBALS['_fair_pll_translation_groups'][42] = array(
			'en' => 42,
			'fr' => 43,
		);

		$syncing = new \ReflectionProperty( PostTranslationLinks::class, 'syncing' );
		if ( PHP_VERSION_ID < 80100 ) {
			$syncing->setAccessible( true );
		}
		$syncing->setValue( null, array( '42:43' => true ) );

		PostTranslationLinks::sync_saved_post( 42 );

		$this->assertSame( array( '42:43' => true ), $syncing->getValue() );
	}
}
