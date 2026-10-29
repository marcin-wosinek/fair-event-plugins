<?php
/**
 * BlockNameMigration content rewrite tests.
 *
 * Stored content saved under the legacy fair-audience/fair-form* block names
 * is rewritten to the canonical fair-form/fair-form* names (#1161). Only the
 * sixteen known names may change, in every delimiter form, and nothing else
 * in the content.
 *
 * @package FairForm
 */

namespace FairForm\Tests\Services;

use FairForm\Hooks\BlockHooks;
use FairForm\Services\BlockNameMigration;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for BlockNameMigration::rewrite_content().
 */
class BlockNameMigrationTest extends TestCase {

	/**
	 * Nested, mixed content: a legacy form with a conditional section, a
	 * select with options and unrelated core and Fair Audience blocks.
	 */
	public function test_rewrites_nested_legacy_blocks_and_keeps_everything_else(): void {
		$legacy = implode(
			"\n",
			array(
				'<!-- wp:paragraph -->',
				'<p>Mention of wp:fair-audience/fair-form in text stays.</p>',
				'<!-- /wp:paragraph -->',
				'<!-- wp:fair-audience/fair-form {"formId":"f-1","notificationEmail":"a@example.com"} -->',
				'<!-- wp:fair-audience/fair-form-short-text {"questionKey":"name","questionText":"Name <!--"} /-->',
				'<!-- wp:fair-audience/fair-form-conditional {"conditionQuestionKey":"name","conditionOperator":"not_empty"} -->',
				'<!-- wp:fair-audience/fair-form-select-one {"questionKey":"size"} -->',
				'<!-- wp:fair-audience/fair-form-option {"value":"S"} /-->',
				'<!-- /wp:fair-audience/fair-form-select-one -->',
				'<!-- /wp:fair-audience/fair-form-conditional -->',
				'<!-- wp:fair-audience/mailing-signup /-->',
				'<!-- /wp:fair-audience/fair-form -->',
			)
		);

		$expected = implode(
			"\n",
			array(
				'<!-- wp:paragraph -->',
				'<p>Mention of wp:fair-audience/fair-form in text stays.</p>',
				'<!-- /wp:paragraph -->',
				'<!-- wp:fair-form/fair-form {"formId":"f-1","notificationEmail":"a@example.com"} -->',
				'<!-- wp:fair-form/fair-form-short-text {"questionKey":"name","questionText":"Name <!--"} /-->',
				'<!-- wp:fair-form/fair-form-conditional {"conditionQuestionKey":"name","conditionOperator":"not_empty"} -->',
				'<!-- wp:fair-form/fair-form-select-one {"questionKey":"size"} -->',
				'<!-- wp:fair-form/fair-form-option {"value":"S"} /-->',
				'<!-- /wp:fair-form/fair-form-select-one -->',
				'<!-- /wp:fair-form/fair-form-conditional -->',
				'<!-- wp:fair-audience/mailing-signup /-->',
				'<!-- /wp:fair-form/fair-form -->',
			)
		);

		$this->assertSame( $expected, BlockNameMigration::rewrite_content( $legacy ) );
	}

	/**
	 * Every legacy name maps to its canonical name, in opening, closing and
	 * self-closing delimiters.
	 *
	 * @return array<string, array{string, string}>
	 */
	public static function legacy_names(): array {
		$cases = array();
		foreach ( BlockHooks::LEGACY_NAMES as $legacy => $canonical ) {
			$cases[ $legacy ] = array( $legacy, $canonical );
		}
		return $cases;
	}

	/**
	 * Each of the sixteen names is renamed.
	 *
	 * @param string $legacy    Legacy block name.
	 * @param string $canonical Canonical block name.
	 */
	#[DataProvider( 'legacy_names' )]
	public function test_rewrites_each_legacy_name( string $legacy, string $canonical ): void {
		$this->assertSame(
			"<!-- wp:{$canonical} /--><!-- wp:{$canonical} {\"a\":1} --><!-- /wp:{$canonical} -->",
			BlockNameMigration::rewrite_content( "<!-- wp:{$legacy} /--><!-- wp:{$legacy} {\"a\":1} --><!-- /wp:{$legacy} -->" )
		);
	}

	/**
	 * Names that merely start like a legacy name, and other namespaces, are
	 * left alone.
	 */
	public function test_leaves_unknown_and_unrelated_names(): void {
		$content = '<!-- wp:fair-audience/fair-form-unknown /-->'
			. '<!-- wp:fair-audience/fair-formx /-->'
			. '<!-- wp:fair-audience/event-signup /-->'
			. '<!-- wp:fair-form/fair-form /-->'
			. '<!-- wp:other/fair-audience-fair-form /-->';

		$this->assertSame( $content, BlockNameMigration::rewrite_content( $content ) );
	}

	/**
	 * Rewriting already migrated content changes nothing.
	 */
	public function test_is_idempotent(): void {
		$once = BlockNameMigration::rewrite_content( '<!-- wp:fair-audience/fair-form --><!-- wp:fair-audience/fair-form-email /--><!-- /wp:fair-audience/fair-form -->' );

		$this->assertSame( '<!-- wp:fair-form/fair-form --><!-- wp:fair-form/fair-form-email /--><!-- /wp:fair-form/fair-form -->', $once );
		$this->assertSame( $once, BlockNameMigration::rewrite_content( $once ) );
	}

	/**
	 * Canonical name lookup accepts both namespaces and passes other names
	 * through.
	 */
	public function test_canonical_name(): void {
		$this->assertSame( 'fair-form/fair-form-option', BlockHooks::canonical_name( 'fair-audience/fair-form-option' ) );
		$this->assertSame( 'fair-form/fair-form-option', BlockHooks::canonical_name( 'fair-form/fair-form-option' ) );
		$this->assertSame( 'core/paragraph', BlockHooks::canonical_name( 'core/paragraph' ) );
		$this->assertNull( BlockHooks::canonical_name( null ) );
	}
}
