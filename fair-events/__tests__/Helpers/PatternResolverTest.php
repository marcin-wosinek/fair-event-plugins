<?php
/**
 * PatternResolver::classify() unit tests
 *
 * Pure-logic tests only — resolve() requires a live WordPress environment
 * (get_post(), WP_Block_Patterns_Registry) and is covered by the WP-CLI
 * eval-file manual check instead (see TESTING.md).
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\PatternResolver;

/**
 * Tests for PatternResolver::classify()
 */
class PatternResolverTest extends TestCase {

	/**
	 * A Query Loop pattern (containing wp:query) classifies as query-loop.
	 */
	public function test_query_block_classifies_as_query_loop() {
		$content = '<!-- wp:query {"query":{"postType":"fair_event"}} --><div class="wp-block-query"></div><!-- /wp:query -->';

		$this->assertSame( PatternResolver::TYPE_QUERY_LOOP, PatternResolver::classify( $content ) );
	}

	/**
	 * A pattern containing wp:post-template (but not a literal wp:query
	 * comment, e.g. because it's nested inside a group) still classifies as
	 * query-loop.
	 */
	public function test_post_template_classifies_as_query_loop() {
		$content = '<!-- wp:post-template --><!-- wp:post-title /--><!-- /wp:post-template -->';

		$this->assertSame( PatternResolver::TYPE_QUERY_LOOP, PatternResolver::classify( $content ) );
	}

	/**
	 * A pattern with no Query Loop markup classifies as per-event.
	 */
	public function test_plain_pattern_classifies_as_per_event() {
		$content = '<!-- wp:html --><a href="{{url}}">{{title}}</a><!-- /wp:html -->';

		$this->assertSame( PatternResolver::TYPE_PER_EVENT, PatternResolver::classify( $content ) );
	}

	/**
	 * A pattern using native post blocks without a query wrapper (e.g. a
	 * per-event pattern for post-backed occurrences) also classifies as
	 * per-event — only the Query Loop wrapper itself makes it query-loop.
	 */
	public function test_post_title_without_query_classifies_as_per_event() {
		$content = '<!-- wp:post-title {"isLink":true} /-->';

		$this->assertSame( PatternResolver::TYPE_PER_EVENT, PatternResolver::classify( $content ) );
	}
}
