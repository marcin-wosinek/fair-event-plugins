<?php
/**
 * EventTranslation tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\EventTranslation;

/**
 * Covers the fallback behavior available in this process (Polylang absent)
 * and, in separate processes with local `pll_*` stubs, the actual
 * translation-resolution calls.
 */
class EventTranslationTest extends TestCase {

	/**
	 * Build a post-linked occurrence DTO.
	 *
	 * @param array $overrides Fields to override on top of the defaults.
	 * @return array Occurrence DTO.
	 */
	private function occurrence( array $overrides = array() ) {
		return array_merge(
			array(
				'event_id'        => 5,
				'occurrence_type' => 'single',
				'source'          => 'post',
				'link_type'       => 'post',
				'title'           => 'Post 5',
				'url'             => 'https://example.com/?p=5',
				'start'           => '2026-08-11 10:00:00',
			),
			$overrides
		);
	}

	/**
	 * Fallback behavior in the default process (Polylang absent):
	 * translate_occurrences() returns the input unchanged.
	 */
	public function test_returns_occurrences_unchanged_when_polylang_absent() {
		$occurrences = array( $this->occurrence() );

		$this->assertSame( $occurrences, EventTranslation::translate_occurrences( $occurrences ) );
	}

	/**
	 * Non-post-linked occurrences (standalone/external) are left alone even
	 * when Polylang is present, since resolving a translation only makes
	 * sense for a linked WordPress post.
	 *
	 * @runInSeparateProcess
	 */
	public function test_non_post_source_is_left_unchanged() {
		require_once __DIR__ . '/../pll-stubs.php';

		$GLOBALS['_fair_pll_current_language']         = 'fr';
		$GLOBALS['_fair_pll_translated_posts']['5:fr'] = 6;

		$occurrence = $this->occurrence(
			array(
				'source'   => 'standalone',
				'event_id' => null,
			)
		);

		$result = EventTranslation::translate_occurrences( array( $occurrence ) );

		$this->assertSame( $occurrence, $result[0] );
		$this->assertSame( array(), $GLOBALS['_fair_pll_get_post_calls'] );
	}

	/**
	 * A post-linked event date whose calendar link is configured as an
	 * external URL (`link_type: 'external'`) is left unchanged, even though
	 * `event_id`/`source: 'post'` are set — the event's own CPT post having
	 * a translation is irrelevant, since the occurrence doesn't link there.
	 *
	 * @runInSeparateProcess
	 */
	public function test_external_link_type_is_left_unchanged() {
		require_once __DIR__ . '/../pll-stubs.php';

		$GLOBALS['_fair_pll_current_language']         = 'fr';
		$GLOBALS['_fair_pll_translated_posts']['5:fr'] = 6;

		$occurrence = $this->occurrence(
			array(
				'link_type' => 'external',
				'url'       => 'https://tickets.example.com/event',
			)
		);

		$result = EventTranslation::translate_occurrences( array( $occurrence ) );

		$this->assertSame( $occurrence, $result[0] );
		$this->assertSame( array(), $GLOBALS['_fair_pll_get_post_calls'] );
	}

	/**
	 * A post-linked event date whose calendar link is configured to a
	 * different junction-linked post (`link_type: 'none'`) is left
	 * unchanged for the same reason — url/title didn't come from
	 * `event_id`'s own post.
	 *
	 * @runInSeparateProcess
	 */
	public function test_none_link_type_is_left_unchanged() {
		require_once __DIR__ . '/../pll-stubs.php';

		$GLOBALS['_fair_pll_current_language']         = 'fr';
		$GLOBALS['_fair_pll_translated_posts']['5:fr'] = 6;

		$occurrence = $this->occurrence(
			array(
				'link_type' => 'none',
				'url'       => 'https://example.com/?p=99',
				'title'     => 'Post 99',
			)
		);

		$result = EventTranslation::translate_occurrences( array( $occurrence ) );

		$this->assertSame( $occurrence, $result[0] );
		$this->assertSame( array(), $GLOBALS['_fair_pll_get_post_calls'] );
	}

	/**
	 * No translation mapped for the current language: falls back to the
	 * original title/url unchanged.
	 *
	 * @runInSeparateProcess
	 */
	public function test_falls_back_when_no_translation_exists() {
		require_once __DIR__ . '/../pll-stubs.php';

		$GLOBALS['_fair_pll_current_language'] = 'fr';

		$occurrence = $this->occurrence();

		$result = EventTranslation::translate_occurrences( array( $occurrence ) );

		$this->assertSame( $occurrence, $result[0] );
	}

	/**
	 * A published translation swaps in the translated post's title/url.
	 *
	 * @runInSeparateProcess
	 */
	public function test_swaps_in_published_translation() {
		require_once __DIR__ . '/../pll-stubs.php';

		$GLOBALS['_fair_pll_current_language']         = 'fr';
		$GLOBALS['_fair_pll_translated_posts']['5:fr'] = 6;

		$result = EventTranslation::translate_occurrences( array( $this->occurrence() ) );

		$this->assertSame( 'Post 6', $result[0]['title'] );
		$this->assertSame( 'https://example.com/?p=6', $result[0]['url'] );
	}

	/**
	 * A `generated` occurrence keeps its `?event_date=` disambiguation arg,
	 * appended to the translated post's permalink.
	 *
	 * @runInSeparateProcess
	 */
	public function test_generated_occurrence_keeps_event_date_arg_on_translated_url() {
		require_once __DIR__ . '/../pll-stubs.php';

		$GLOBALS['_fair_pll_current_language']         = 'fr';
		$GLOBALS['_fair_pll_translated_posts']['5:fr'] = 6;

		$occurrence = $this->occurrence(
			array(
				'occurrence_type' => 'generated',
				'start'           => '2026-08-18 10:00:00',
			)
		);

		$result = EventTranslation::translate_occurrences( array( $occurrence ) );

		$this->assertSame( 'https://example.com/?p=6&event_date=2026-08-18', $result[0]['url'] );
	}

	/**
	 * A non-`generated` occurrence's translated url has no `event_date` arg
	 * appended.
	 *
	 * @runInSeparateProcess
	 */
	public function test_single_occurrence_translated_url_has_no_event_date_arg() {
		require_once __DIR__ . '/../pll-stubs.php';

		$GLOBALS['_fair_pll_current_language']         = 'fr';
		$GLOBALS['_fair_pll_translated_posts']['5:fr'] = 6;

		$result = EventTranslation::translate_occurrences( array( $this->occurrence() ) );

		$this->assertSame( 'https://example.com/?p=6', $result[0]['url'] );
	}

	/**
	 * A translation that resolves to an unpublished post is treated as "no
	 * translation" — falls back to the original occurrence.
	 *
	 * @runInSeparateProcess
	 */
	public function test_falls_back_when_translation_is_not_published() {
		require_once __DIR__ . '/../pll-stubs.php';

		$GLOBALS['_fair_pll_current_language']         = 'fr';
		$GLOBALS['_fair_pll_translated_posts']['5:fr'] = 6;
		$GLOBALS['_fair_test_post_status'][6]          = 'draft';

		$occurrence = $this->occurrence();

		$result = EventTranslation::translate_occurrences( array( $occurrence ) );

		$this->assertSame( $occurrence, $result[0] );
	}

	/**
	 * `pll_get_post()` resolving the original post id itself (Polylang's
	 * documented behavior when no translation exists) is treated the same
	 * as "no translation".
	 *
	 * @runInSeparateProcess
	 */
	public function test_falls_back_when_translation_resolves_to_the_same_post() {
		require_once __DIR__ . '/../pll-stubs.php';

		$GLOBALS['_fair_pll_current_language']         = 'fr';
		$GLOBALS['_fair_pll_translated_posts']['5:fr'] = 5;

		$occurrence = $this->occurrence();

		$result = EventTranslation::translate_occurrences( array( $occurrence ) );

		$this->assertSame( $occurrence, $result[0] );
	}

	/**
	 * The same event_id repeated across occurrences (a recurring series)
	 * only resolves the Polylang translation once per render.
	 *
	 * @runInSeparateProcess
	 */
	public function test_caches_translation_lookup_across_occurrences() {
		require_once __DIR__ . '/../pll-stubs.php';

		$GLOBALS['_fair_pll_current_language']         = 'fr';
		$GLOBALS['_fair_pll_translated_posts']['5:fr'] = 6;

		EventTranslation::translate_occurrences(
			array(
				$this->occurrence( array( 'start' => '2026-08-11 10:00:00' ) ),
				$this->occurrence( array( 'start' => '2026-08-18 10:00:00' ) ),
			)
		);

		$this->assertSame( array( '5:fr' ), $GLOBALS['_fair_pll_get_post_calls'] );
	}
}
