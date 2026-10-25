<?php
/**
 * Tests for operator weekly-summary links.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Frontend;

use FairEventsExperimental\Frontend\WeeklySummaryPage;
use FairEventsExperimental\Services\WeeklySummary;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Feed slugs in links, and the links built for each permalink setting.
 */
class WeeklySummaryPageTest extends TestCase {

	/**
	 * Restore the global rewrite object.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['wp_rewrite'] );
	}

	/**
	 * Use a fake rewrite object.
	 *
	 * @param bool   $pretty Whether the site uses pretty permalinks.
	 * @param string $root   Permalink root, e.g. 'index.php/'.
	 * @return void
	 */
	private static function permalinks( $pretty, $root = '' ) {
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, removed in tearDown().
		$GLOBALS['wp_rewrite'] = new class( $pretty, $root ) {
			/**
			 * Permalink root.
			 *
			 * @var string
			 */
			public $root;

			/**
			 * Whether pretty permalinks are on.
			 *
			 * @var bool
			 */
			private $pretty;

			/**
			 * Constructor.
			 *
			 * @param bool   $pretty Pretty permalinks.
			 * @param string $root   Permalink root.
			 */
			public function __construct( $pretty, $root ) {
				$this->pretty = $pretty;
				$this->root   = $root;
			}

			/**
			 * Whether pretty permalinks are on.
			 *
			 * @return bool
			 */
			public function using_permalinks() {
				return $this->pretty;
			}
		};
	}

	/**
	 * Slugs a link may carry.
	 *
	 * @return array[]
	 */
	public static function slugs() {
		return array(
			'plain slug'      => array( 'valencia', true ),
			'with digits'     => array( 'acro-valencia-2', true ),
			'empty'           => array( '', false ),
			'uppercase'       => array( 'Valencia', false ),
			'space'           => array( 'acro valencia', false ),
			'path traversal'  => array( '../valencia', false ),
			'query injection' => array( 'valencia&week=2026-W01', false ),
			'not a string'    => array( array( 'valencia' ), false ),
		);
	}

	/**
	 * Only values sanitize_title() leaves unchanged name a feed.
	 *
	 * @param mixed $slug     Slug from the link.
	 * @param bool  $expected Whether it is accepted.
	 * @return void
	 */
	#[DataProvider( 'slugs' )]
	public function test_slug_validation( $slug, $expected ) {
		$this->assertSame( $expected, WeeklySummary::is_valid_slug( $slug ) );
	}

	/**
	 * Pretty permalinks put the feed in the path.
	 *
	 * @return void
	 */
	public function test_pretty_permalink_url() {
		self::permalinks( true );

		$this->assertSame(
			'https://example.test/fair-events-weekly-summary/valencia/',
			WeeklySummaryPage::url( 'valencia' )
		);
		$this->assertSame(
			'https://example.test/fair-events-weekly-summary/valencia/?week=2026-W44',
			WeeklySummaryPage::url( 'valencia', '2026-W44' )
		);
	}

	/**
	 * PATHINFO permalinks keep their index.php root.
	 *
	 * @return void
	 */
	public function test_index_permalink_url() {
		self::permalinks( true, 'index.php/' );

		$this->assertSame(
			'https://example.test/index.php/fair-events-weekly-summary/madrid/',
			WeeklySummaryPage::url( 'madrid' )
		);
	}

	/**
	 * Plain permalinks carry the feed in the query string, never in `feed`.
	 *
	 * @return void
	 */
	public function test_plain_permalink_url() {
		self::permalinks( false );

		$this->assertSame(
			'https://example.test/?fair_weekly_summary=barcelona',
			WeeklySummaryPage::url( 'barcelona' )
		);
		$this->assertSame(
			'https://example.test/?fair_weekly_summary=barcelona&week=2032-W53',
			WeeklySummaryPage::url( 'barcelona', '2032-W53' )
		);
	}
}
